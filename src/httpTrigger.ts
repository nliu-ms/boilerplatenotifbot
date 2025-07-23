import { AzureFunction, Context, HttpRequest } from "@azure/functions";
import * as ACData from "adaptivecards-templating";
import notificationTemplate from "./adaptiveCards/notification-default.json";
import { notificationApp } from "./internal/initialize";

const httpTrigger: AzureFunction = async function (
  context: Context,
  req: HttpRequest
): Promise<void> {
  const pageSize = 100;
  let continuationToken: string | undefined = undefined;
  do {
    const pagedData = await notificationApp.getPagedInstallations(
      pageSize,
      continuationToken
    );
    const installations = pagedData.data;
    continuationToken = pagedData.continuationToken;

    for (const target of installations) {
      if (target.type === "channel") {
        // If the target is a Team, select member
        const members = await target.getPagedMembers(100, undefined);
        members.data.forEach(async user => {
          if (user.account.email == "someone@contoso.onmicrosoft.com") {
            await user.sendAdaptiveCard(
            new ACData.Template(notificationTemplate).expand({
              $root: {
                title: "New Event Occurred!",
                appName: "Contoso App Notification",
                description: `This is a sample http-triggered notification to ${user.type}`,
                notificationUrl: "https://aka.ms/teamsfx-notification-new",
              },
            })
          );
          }
          
        });
      }
    }
  } while (continuationToken);

  context.res = {};
};

export default httpTrigger;
