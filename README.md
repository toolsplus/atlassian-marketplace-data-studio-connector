# Atlassian Marketplace Connector for Google Data Studio

**⚠️ DEPRECATED** Fetching export data directly from the Atlassian Marketplace API is generally quite slow. As a result
Data Studio reports that fetch data using this connector load fairly slow. In an effort to try to fix this we are deprecating
this connector in favor of a new Google Sheets connector: https://github.com/toolsplus/atlassian-marketplace-sheets-connector.
The Google Sheets connector allows you to load Marketplace data into a Google Sheet which can then be imported into Data Studio
using the Data Studio native Google Sheet connector.

---

Bring your Atlassian Marketplace data to Google Data Studio and create reports and charts to visualize your sales
performance, licensing data or, conversion events.

🗄️️ Available datasets:

* [Transactions](https://developer.atlassian.com/platform/marketplace/rest/api-group-reporting/#api-vendors-vendorid-reporting-sales-transactions-export-get)
* [Licenses](https://developer.atlassian.com/platform/marketplace/rest/api-group-reporting/#api-vendors-vendorid-reporting-licenses-export-get)
* [Feedback](https://developer.atlassian.com/platform/marketplace/rest/api-group-reporting/#api-vendors-vendorid-reporting-feedback-details-export-get)
* [Churn events](https://developer.atlassian.com/platform/marketplace/rest/api-group-reporting/#api-vendors-vendorid-reporting-sales-metrics-salemetric-details-export-get)
* [Conversion events](https://developer.atlassian.com/platform/marketplace/rest/api-group-reporting/#api-vendors-vendorid-reporting-sales-metrics-salemetric-details-export-get)
* [Renewal events](https://developer.atlassian.com/platform/marketplace/rest/api-group-reporting/#api-vendors-vendorid-reporting-sales-metrics-salemetric-details-export-get)

## Get started

### Build and deploy the connector to App Script

1. Clone the repository and install dependencies.

        git clone https://github.com/toolsplus/atlassian-marketplace-data-studio-connector
        cd atlassian-marketplace-data-studio-connector
        npm install
        
1. Enable the Google Apps Script API: https://script.google.com/home/usersettings

1. Log in to Google clasp and authorize using your Google account.

        npx clasp login
        
1. Create a new Google Script in your Google Drive.

        npx clasp create --type standalone --title "Atlassian Marketplace Data Studio Connector" --rootDir ./dist
        
1. Deploy the project (production or development build).

        // Production build
        npm run deploy:prod
        
        // Development build
        npm run deploy
        
### Deploy the Atlassian Marketplace connector to Data Studio
       
1. Go to [scripts.google.com](https://script.google.com/) and open the **Atlassian Marketplace Data Studio Connector** project.

1. In the App Script editor click **Publish > Deploy from manifest...**

1. Click on the **Head** version, and you will see a URL showing up. Click on the URL which will bring you directly to Data Studio.
   
   You can also find [instructions for these steps in the Data Studio documentation](https://developers.google.com/datastudio/connector/use).
   
### Setting up the connector

Follow the instructions in Data Studio to set up the Atlassian Marketplace connector. When you are asked for credentials enter the following:

**Username** is the email address that you are using with your Atlassian account.

**Password** is an API token which you can generate at https://id.atlassian.com/manage/api-tokens. Refer to the [Atlassian documentation](https://developer.atlassian.com/platform/marketplace/rest/intro/#auth) for further details on how to generate API tokens.

When you are asked for your **Vendor ID** go to https://marketplace.atlassian.com/manage/apps which will redirect you to an URL of the following format:
    
    https://marketplace.atlassian.com/manage/vendors/<Vendor ID>/addons
    
Simply copy-paste your vendor id from the URL into the Data Studio connector configuration.

Once you entered all the details click **Connect** in the top right corner.

🎉 That's it, you are now ready to chart your Atlassian Marketplace data in Data Studio.
