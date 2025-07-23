import { NotificationBot } from "../notification/notification";
import { AuthConfiguration, loadAuthConfigFromEnv, CloudAdapter } from "@microsoft/agents-hosting";
import { LocalConversationReferenceStore } from "../notification/storage";
import * as path from "path";

const authConfig: AuthConfiguration = loadAuthConfigFromEnv();
// Create adapter
export const adapter = new CloudAdapter(authConfig);

adapter.onTurnError = async (context, error) => {
  // This check writes out errors to console.
  console.error(`[onTurnError] unhandled error`, error);

  // Only send error message for user messages, not for other message types so the bot doesn't spam a channel or chat.
  if (context.activity.type === "message") {
    // Send a trace activity, which will be displayed in Bot Framework Emulator
    await context.sendTraceActivity(
      "OnTurnError Trace",
      error instanceof Error ? error.message : error,
      "https://www.botframework.com/schemas/error",
      "TurnError"
    );

    // Send a message to the user
    await context.sendActivity(`The bot encountered unhandled error: ${error.message}`);
    await context.sendActivity("To continue to run this bot, please fix the bot source code.");
  }
};

export const localStorage = new LocalConversationReferenceStore(
  path.resolve(process.env.RUNNING_ON_AZURE === "1" ? process.env.TEMP ?? "./" : "./")
);

export const notificationApp = new NotificationBot(adapter, localStorage, authConfig.clientId);