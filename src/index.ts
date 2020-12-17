// This script is originally based on the Kaggle open source connector
// https://github.com/googledatastudio/community-connectors/tree/master/kaggle

const USER_NAME_PROPERTY_KEY = "dscc.username";
const PASSWORD_PROPERTY_KEY = "dscc.password";
const MARKETPLACE_BASE_URL = "https://marketplace.atlassian.com";
const MARKETPLACE_API_BASE_URL = `${MARKETPLACE_BASE_URL}/rest/2`;

const marketplaceVendorBaseUrl = (vendorId: string) =>
  `${MARKETPLACE_API_BASE_URL}/vendors/${vendorId}`;

/**
 * Describes user-provided configuration
 */
interface ConfigParams {
  /**
   * Vendor-relative Marketplace API endpoint for this data connection.
   *
   * Value contains a relative path pointing to any of the available export endpoints, e.g.
   * `reporting/licenses/export` or `reporting/sales/transactions/export`.
   */
  datasetApiPath: string;
  vendorId: string;
}

interface Credentials {
  username: string;
  password: string;
}

type CsvData = string[][];

interface FieldSchemaBase {
  name: string;
  label: string;
}

interface NumberFieldSchema extends FieldSchemaBase {
  dataType: "NUMBER";
  semantics: {
    conceptType: "METRIC";
    isReaggregatable: boolean;
  };
}

interface StringFieldSchema extends FieldSchemaBase {
  dataType: "STRING";
  semantics: {
    conceptType: "DIMENSION";
  };
}

type FieldSchema = NumberFieldSchema | StringFieldSchema;

interface DataRow {
  values: string[];
}

interface GetDataResponse {
  schema: FieldSchema[];
  rows: DataRow[];
}

interface GetSchemaResponse {
  schema: FieldSchema[];
}

/**
 * Dummy error response to make the Typescript compiler happy and gives us
 * control flow based type analysis.
 *
 * It is not clear what to return if any of the connector functions fail so
 * resort to return an empty object.
 */
function dummyErrorResponse<T>(): T {
  return {} as T;
}

function throwConnectorError(message: string) {
  const cc = DataStudioApp.createCommunityConnector();
  cc.newUserError().setText(message).throwException();
}

/**
 * Calls the Atlassian Marketplace API to fetch CSV data from the given configuration.
 *
 * Note that by setting `muteHttpExceptions` to `true` this function will not throw
 * if the API call a response code that indicates an error and instead returns a regular
 * `HTTPResponse` object.
 *
 * @param configuration User-configured options for this connector instance
 * @param credentials Credentials to authenticated the API call
 */
function vendorApiFetch(
  configuration: ConfigParams,
  credentials: Credentials
): GoogleAppsScript.URL_Fetch.HTTPResponse {
  const fullUrl = `${marketplaceVendorBaseUrl(configuration.vendorId)}/${
    configuration.datasetApiPath
  }?accept=csv`;
  const authParamPlain = `${credentials.username}:${credentials.password}`;
  const authParamBase64 = Utilities.base64Encode(authParamPlain);
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    headers: {
      Authorization: `Basic ${authParamBase64}`,
    },
    muteHttpExceptions: true,
  };
  let result;
  try {
    result = UrlFetchApp.fetch(fullUrl, options);
  } catch (e) {
    Logger.log(`[vendorApiFetch] Failed to fetch ${fullUrl}`, { error: e });
    return dummyErrorResponse();
  }

  return result;
}

/**
 * Fetches the stored user credentials.
 *
 * @returns Credentials if both username and password are defined or undefined otherwise
 */
function getStoredCredentials(): Credentials | undefined {
  const properties = PropertiesService.getUserProperties();
  const username = properties.getProperty(USER_NAME_PROPERTY_KEY);

  if (!username) {
    Logger.log("Username returned null");
    return;
  }

  const password = properties.getProperty(PASSWORD_PROPERTY_KEY);

  if (!password) {
    Logger.log("Password returned null");
    return;
  }

  return {
    username: username,
    password: password,
  };
}

/**
 * Returns the schema cache key for the given Marketplace API endpoint.
 * @param datasetEndpoint User-provided dataset API endpoint
 */
function getSchemaCacheKey(datasetEndpoint: string): string {
  return `schema--${datasetEndpoint.split("/").join("--")}`;
}

/**
 * Caches the given schema in the script cache.
 *
 * Note that caching may fail if the underlying cache service does not return
 * a cache instance. In those cases a log message will be recorded.
 *
 * @param schema Schema to cache
 * @param cacheKey Cache key under which to cache the schema
 */
function cacheSchema(schema: FieldSchema[], cacheKey: string): void {
  const maybeCache = CacheService.getScriptCache();
  if (maybeCache) {
    maybeCache.put(cacheKey, JSON.stringify(schema));
  } else {
    Logger.log("Failed to cache schema because script cache was null");
  }
}

/**
 * Tries to fetch the cached schema for the given cache key.
 *
 * @param cacheKey Cache key for which to fetch the schema
 * @returns Cached schema or undefined if none is found.
 */
function getCachedSchema(cacheKey: string): FieldSchema[] | undefined {
  const maybeCache = CacheService.getScriptCache();
  if (maybeCache !== null) {
    const maybeCachedSchema = maybeCache.get(cacheKey);
    if (maybeCachedSchema !== null) {
      return JSON.parse(maybeCachedSchema);
    }
  }
}

/**
 * Calls the Atlassian Marketplace API to fetch CSV data from the given configuration using the credentials stored in
 * the user properties.
 *
 * Note that this function will throw if either the Marketplace API returns any non 200 response code, or parsing the
 * returned CSV data fails.
 * If all operations complete successfully this function will cache the parsed CSV response for some time.
 *
 * @param configuration User-configured options for this connector instance
 */
function getFileData(configuration: ConfigParams): CsvData {
  const credentials = getStoredCredentials();

  if (!credentials) {
    const message = "[getFileData] Cloud not retrieve stored credentials configured";
    Logger.log(message, { configuration });
    throwConnectorError(message);
    return dummyErrorResponse();
  }

  let response: GoogleAppsScript.URL_Fetch.HTTPResponse;
  try {
    response = vendorApiFetch(configuration, credentials);
  } catch (e) {
    const message = "[getFileData] Unexpected error when fetching data from the Marketplace API";
    Logger.log(message, {
      error: JSON.stringify(e),
      configuration: configuration,
    });
    throwConnectorError(message);
    return dummyErrorResponse();
  }

  if (response.getResponseCode() !== 200) {
    const message = "[getFileData] Unhandled Marketplace API response";
    Logger.log(message, { configuration, response });
    throwConnectorError(message);
    return dummyErrorResponse();
  }

  const fileContent = response.getContentText();

  // Fix the bug on Utilities.parseCsv() google script function which does not allow newlines in csv strings
  // https://gist.github.com/simonjamain/7e23b898527655609e5ff012f412dd50
  const sanitizedFileContent = fileContent.replace(/(["'])(?:(?=(\\?))\2[\s\S])*?\1/g, (e) =>
    e.replace(/\r?\n|\r/g, " ")
  );

  try {
    return Utilities.parseCsv(sanitizedFileContent);
  } catch (e) {
    const message = "Unexpected CSV parsing exception";
    Logger.log(message, {
      error: JSON.stringify(e),
      configuration: configuration,
      sanitizedFileContent,
    });
    throwConnectorError(message);
    return dummyErrorResponse();
  }
}

/**
 * Builds the schema for the given data.
 *
 * @param data CSV data for which to build the schema.
 */
function buildSchema(data: CsvData): FieldSchema[] {
  function inferFieldSchema(index: number, columnName: string, fieldData: string): FieldSchema {
    const fieldSchemaCommonProps = {
      name: `c${index}`,
      label: columnName,
    };
    const buildNumberFieldSchema = (): NumberFieldSchema => ({
      ...fieldSchemaCommonProps,
      dataType: "NUMBER",
      semantics: {
        conceptType: "METRIC",
        isReaggregatable: true,
      },
    });
    const buildStringField = (): StringFieldSchema => ({
      ...fieldSchemaCommonProps,
      dataType: "STRING",
      semantics: {
        conceptType: "DIMENSION",
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return isNaN(fieldData as any) ? buildStringField() : buildNumberFieldSchema();
  }

  const columnNames = data[0];
  const firstDataRow = data[1];
  return columnNames.map((name, index) => inferFieldSchema(index, name, firstDataRow[index]));
}

/**
 * Tries to fetch CSV data for the given configuration.
 *
 * @param configuration User-configured options for this connector instance
 * @returns Either the retrieved data or `undefined` if the fetch operation failed.
 */
function fetchCsvData(configuration: ConfigParams): CsvData | undefined {
  try {
    return getFileData(configuration);
  } catch (e) {
    const message = "[fetchCsvData] Failed to fetch CSV data";
    Logger.log(message, {
      error: JSON.stringify(e),
      datasetApiPath: configuration.datasetApiPath,
    });
    throwConnectorError(`${message} ${e}`);
  }
}

/**
 * Fetches the schema for the data retrieved from the given configuration.
 *
 * This will first try to fetch the schema from the script cache. If that fails it will either infer the schema from
 * the given prefetched CSV data or if there is no prefetched data it will fetch the data on the fly.
 *
 * Note that this function will cache any newly computed schema to speed up future invocations.
 *
 * @param configuration User-configured options for this connector instance
 * @param prefetchedCsvData Optional prefetched CSV data for the configured dataset
 */
function getSchemaByDatasetApiPath(
  configuration: ConfigParams,
  prefetchedCsvData?: CsvData
): GetSchemaResponse | undefined {
  const cacheKey = getSchemaCacheKey(configuration.datasetApiPath);
  const maybeCachedSchema = getCachedSchema(cacheKey);

  if (maybeCachedSchema) {
    return { schema: maybeCachedSchema };
  }

  const maybeCsvData = prefetchedCsvData ? prefetchedCsvData : fetchCsvData(configuration);

  if (maybeCsvData) {
    const schema = buildSchema(maybeCsvData);
    cacheSchema(schema, cacheKey);
    return { schema };
  }

  Logger.log(
    "[getSchemaByDatasetApiPath] Failed to get schema: There is no cached schema, prefetched CSV data or fetching CSV data to infer the schema did not return any data.",
    {
      maybeCsvData,
      maybeCachedSchema,
      datasetApiPath: configuration.datasetApiPath,
      hasPrefetchedCsvData: !!prefetchedCsvData,
    }
  );
}

/**
 * Validates the given credentials by calling "GET vendors" Marketplace API endpoint with the query parameter `forThisUser=true`.
 *
 * Note that the "GET vendors" endpoint will return 400 if credentials are invalid or missing.
 *
 * @see https://developer.atlassian.com/platform/marketplace/rest/api-group-vendors/#api-vendors-get
 * @param username Configured username
 * @param password Configured password
 * @returns True if the given credentials are valid, false otherwise
 */
function validateCredentials(username: string, password: string): boolean {
  if (username === null || password === null) {
    return false;
  }
  const authParamPlain = `${username}:${password}`;
  const authParamBase64 = Utilities.base64Encode(authParamPlain);
  const options = {
    headers: {
      Authorization: `Basic ${authParamBase64}`,
    },
  };

  const validationEndpoint = `${MARKETPLACE_API_BASE_URL}/vendors?forThisUser=true`;

  try {
    return UrlFetchApp.fetch(validationEndpoint, options).getResponseCode() === 200;
  } catch (err) {
    return false;
  }
}

// https://developers.google.com/datastudio/connector/reference#getauthtype
function getAuthType(): GoogleAppsScript.Data_Studio.GetAuthTypeResponse {
  const cc = DataStudioApp.createCommunityConnector();
  return cc.newAuthTypeResponse().setAuthType(cc.AuthType.USER_PASS).build();
}

// https://developers.google.com/datastudio/connector/reference#getconfig
function getConfig(): GoogleAppsScript.Data_Studio.Config {
  const cc = DataStudioApp.createCommunityConnector();
  const ccConfig = cc.getConfig();
  ccConfig.setDateRangeRequired(false);
  ccConfig
    .newSelectSingle()
    .setId("datasetApiPath")
    .setName("Dataset")
    .setHelpText("Select any of the available Marketplace datasets")
    .addOption(
      ccConfig.newOptionBuilder().setLabel("Feedback").setValue("reporting/feedback/details/export")
    )
    .addOption(
      ccConfig.newOptionBuilder().setLabel("Licenses").setValue("reporting/licenses/export")
    )
    .addOption(
      ccConfig
        .newOptionBuilder()
        .setLabel("Transactions")
        .setValue("reporting/sales/transactions/export")
    )
    .addOption(
      ccConfig
        .newOptionBuilder()
        .setLabel("Churn events")
        .setValue("reporting/sales/metrics/churn/details/export")
    )
    .addOption(
      ccConfig
        .newOptionBuilder()
        .setLabel("Conversion events")
        .setValue("reporting/sales/metrics/conversion/details/export")
    )
    .addOption(
      ccConfig
        .newOptionBuilder()
        .setLabel("Renewal events")
        .setValue("reporting/sales/metrics/renewal/details/export")
    );

  ccConfig
    .newTextInput()
    .setId("vendorId")
    .setName("Vendor ID")
    .setHelpText("Enter the unique identifier for your vendor account, e.g. 1234567");
  return ccConfig.build();
}

// https://developers.google.com/datastudio/connector/reference#getschema
function getSchema(request: GoogleAppsScript.Data_Studio.Request<ConfigParams>): GetSchemaResponse {
  const maybeSchema = getSchemaByDatasetApiPath(request.configParams);

  if (maybeSchema) {
    return maybeSchema;
  }

  Logger.log(
    "Failed to get schema: There is no cached schema and fetching CSV data to infer the schema did not return any data.",
    { maybeSchema, datasetApiPath: request.configParams.datasetApiPath }
  );
  throwConnectorError(
    `[getSchema()] Unable to retrieve schema for ${request.configParams.datasetApiPath}: There is no cached schema and fetching CSV data to infer the schema did not return any data.`
  );

  return dummyErrorResponse();
}

// https://developers.google.com/datastudio/connector/reference#getdata
function getData(request: GoogleAppsScript.Data_Studio.Request<ConfigParams>): GetDataResponse {
  // extractRequestedFieldSchemaSubset assumes that there is a field schema for each of the requested fields.
  const extractRequestedFieldSchemaSubset = (schema: FieldSchema[]) => (
    requestedFields: { name: string }[]
  ): FieldSchema[] =>
    requestedFields.map(
      (field) => schema.find((fieldSchema) => fieldSchema.name === field.name) as FieldSchema
    );

  function extractRequestedData(data: CsvData, schema: FieldSchema[]): DataRow[] {
    const columnNames = data[0];
    const dataRows = data.slice(1);
    const dataIndexes = schema.map((fieldSchema) => columnNames.indexOf(fieldSchema.label));
    return dataRows.map((row, rowIndex) => {
      const rowData = dataIndexes.map((columnIndex) => data[rowIndex][columnIndex]);
      return { values: rowData };
    });
  }

  const datasetApiPath = request.configParams.datasetApiPath;
  const maybeCsvData = fetchCsvData(request.configParams);

  if (!maybeCsvData) {
    const message = `Unable to fetch CSV data for ${datasetApiPath}`;
    Logger.log(message, { datasetApiPath, maybeCsvData });
    throwConnectorError(`[getData()] ${message}`);
    return dummyErrorResponse();
  }

  const maybeSchema = getSchemaByDatasetApiPath(request.configParams, maybeCsvData);

  if (!maybeSchema) {
    const message = `Failed to fetch schema for CSV data of ${datasetApiPath}`;
    Logger.log(message, { datasetApiPath, maybeSchema });
    throwConnectorError(`[getData()] ${message}`);
    return dummyErrorResponse();
  }

  const requestedFieldSchema = extractRequestedFieldSchemaSubset(maybeSchema.schema)(
    request.fields
  );

  return {
    schema: requestedFieldSchema,
    rows: extractRequestedData(maybeCsvData, requestedFieldSchema),
  };
}

// https://developers.google.com/datastudio/connector/reference#isauthvalid
function isAuthValid(): boolean {
  const credentials = getStoredCredentials();
  if (!credentials) {
    return false;
  }
  return validateCredentials(credentials.username, credentials.password);
}

// https://developers.google.com/datastudio/connector/reference#setcredentials
function setCredentials(request: { userPass: { username: string; password: string } }) {
  const credentials = request.userPass;
  const username = credentials.username;
  const password = credentials.password;

  if (!validateCredentials(username, password)) {
    return {
      errorCode: "INVALID_CREDENTIALS",
    };
  }

  const userProperties = PropertiesService.getUserProperties();
  userProperties.setProperty(USER_NAME_PROPERTY_KEY, username);
  userProperties.setProperty(PASSWORD_PROPERTY_KEY, password);
  return {
    errorCode: "NONE",
  };
}

// https://developers.google.com/datastudio/connector/reference#resetauth
function resetAuth() {
  const userProperties = PropertiesService.getUserProperties();
  userProperties.deleteProperty(USER_NAME_PROPERTY_KEY);
  userProperties.deleteProperty(PASSWORD_PROPERTY_KEY);
}

// https://developers.google.com/datastudio/connector/reference#isadminuser
function isAdminUser() {
  return true;
}

// Add functions to global object such that they are picked up by the
// gas-webpack-plugin and available in App Script.
// https://github.com/fossamagna/gas-webpack-plugin
global.getAuthType = getAuthType;
global.getConfig = getConfig;
global.getSchema = getSchema;
global.getData = getData;
global.isAuthValid = isAuthValid;
global.setCredentials = setCredentials;
global.resetAuth = resetAuth;
global.isAdminUser = isAdminUser;
