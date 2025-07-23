// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { CloudAdapter, CardFactory, TurnContext, ConnectorClient } from "@microsoft/agents-hosting";
import {
  ChannelInfo,
  TeamsInfo,
  TeamDetails,
  TeamsChannelAccount,
} from "@microsoft/agents-hosting-extensions-teams";
import {
  Activity,
  ActivityTypes,
  ConversationParameters,
  ConversationReference,
} from "@microsoft/agents-activity";
import { PagedData, IStorage } from "./interface";
import { NotificationMiddleware, getKey } from "./middleware";

export function getTeamsBotInstallationId(context: TurnContext): string | undefined {
  const teamId = context.activity?.channelData?.team?.id;
  if (teamId) {
    return teamId;
  }

  // Fallback to use conversation id.
  // The conversation id is equal to team id only when the bot app is installed into the General channel.
  if (context.activity.conversation?.name === undefined && context.activity.conversation?.id) {
    return context.activity.conversation.id;
  }

  return undefined;
}

export interface NotificationTarget {
  /**
   * The type of target, could be "Channel" or "Group" or "Person".
   */
  readonly type?: string;

  /**
   * Send a plain text message.
   *
   * @param text - the plain text message.
   * @param onError - an optional error handler that can catch exceptions during message sending.
   * If not defined, error will be handled by `BotAdapter.onTurnError`.
   *
   * @returns the response of sending message.
   */
  sendMessage(
    text: string,
    onError?: (context: TurnContext, error: Error) => Promise<void>
  ): Promise<{ id?: string }>;

  /**
   * Send an adaptive card message.
   *
   * @param card - the adaptive card raw JSON.
   * @param onError - an optional error handler that can catch exceptions during adaptive card sending.
   * If not defined, error will be handled by `BotAdapter.onTurnError`.
   *
   * @returns the response of sending adaptive card message.
   */
  sendAdaptiveCard(
    card: unknown,
    onError?: (context: TurnContext, error: Error) => Promise<void>
  ): Promise<{ id?: string }>;
}

/**
 * A {@link NotificationTarget} that represents a team channel.
 *
 * @remarks
 * It's recommended to get channels from {@link TeamsBotInstallation.channels()}.
 */
export class Channel implements NotificationTarget {
  /**
   * The parent {@link TeamsBotInstallation} where this channel is created from.
   */
  public readonly parent: TeamsBotInstallation;

  /**
   * Detailed channel information.
   */
  public readonly info: ChannelInfo;

  /**
   * Notification target type. For channel it's always "Channel".
   */
  public readonly type: string = "channel";

  /**
   * Constructor.
   *
   * @remarks
   * It's recommended to get channels from {@link TeamsBotInstallation.channels()}, instead of using this constructor.
   *
   * @param parent - The parent {@link TeamsBotInstallation} where this channel is created from.
   * @param info - Detailed channel information.
   */
  constructor(parent: TeamsBotInstallation, info: ChannelInfo) {
    this.parent = parent;
    this.info = info;
  }

  /**
   * Send a plain text message.
   *
   * @param text - The plain text message.
   * @param onError - An optional error handler that can catch exceptions during message sending.
   * If not defined, error will be handled by `BotAdapter.onTurnError`.
   *
   * @returns The response of sending message.
   */
  public async sendMessage(
    text: string,
    onError?: (context: TurnContext, error: Error) => Promise<void>
  ): Promise<{ id?: string }> {
    const response: { id?: string } = {};
    await this.parent.adapter.continueConversation(
      this.parent.conversationReference as ConversationReference,
      async (context) => {
        const conversation = await this.newConversation(context);
        await this.parent.adapter.continueConversation(conversation, async (ctx: TurnContext) => {
          try {
            const res = await ctx.sendActivity(text);
            response.id = res?.id;
          } catch (error) {
            if (onError) {
              await onError(ctx, error as Error);
            } else {
              throw error;
            }
          }
        });
      }
    );
    return response;
  }

  /**
   * Send an adaptive card message.
   *
   * @param card - The adaptive card raw JSON.
   * @param onError - An optional error handler that can catch exceptions during adaptive card sending.
   * If not defined, error will be handled by `BotAdapter.onTurnError`.
   *
   * @returns The response of sending adaptive card message.
   */
  public async sendAdaptiveCard(
    card: unknown,
    onError?: (context: TurnContext, error: Error) => Promise<void>
  ): Promise<{ id?: string }> {
    const response: { id?: string } = {};
    await this.parent.adapter.continueConversation(
      this.parent.conversationReference as ConversationReference,
      async (context) => {
        const conversation = await this.newConversation(context);
        await this.parent.adapter.continueConversation(conversation, async (ctx: TurnContext) => {
          try {
            const res = await ctx.sendActivity({
              attachments: [CardFactory.adaptiveCard(card)],
              type: ActivityTypes.Message,
            } as Activity);
            response.id = res?.id;
          } catch (error) {
            if (onError) {
              await onError(ctx, error as Error);
            } else {
              throw error;
            }
          }
        });
      },
      true
    );
    return response;
  }

  /**
   * @internal
   */
  private newConversation(context: TurnContext): Promise<ConversationReference> {
    const reference = context.activity.getConversationReference();
    const channelConversation = JSON.parse(JSON.stringify(reference));
    channelConversation.conversation.id = this.info.id || "";

    return Promise.resolve(channelConversation);
  }
}

/**
 * A {@link NotificationTarget} that represents a team member.
 *
 * @remarks
 * It's recommended to get members from {@link TeamsBotInstallation.members()}.
 */
export class Member implements NotificationTarget {
  /**
   * The parent {@link TeamsBotInstallation} where this member is created from.
   */
  public readonly parent: TeamsBotInstallation;

  /**
   * Detailed member account information.
   */
  public readonly account: TeamsChannelAccount;

  /**
   * Notification target type. For member it's always "Person".
   */
  public readonly type: string = "personal";

  /**
   * Constructor.
   *
   * @remarks
   * It's recommended to get members from {@link TeamsBotInstallation.members()}, instead of using this constructor.
   *
   * @param parent - The parent {@link TeamsBotInstallation} where this member is created from.
   * @param account - Detailed member account information.
   */
  constructor(parent: TeamsBotInstallation, account: TeamsChannelAccount) {
    this.parent = parent;
    this.account = account;
  }

  /**
   * Send a plain text message.
   *
   * @param text - The plain text message.
   * @param onError - An optional error handler that can catch exceptions during message sending.
   * If not defined, error will be handled by `BotAdapter.onTurnError`.
   *
   * @returns The response of sending message.
   */
  public async sendMessage(
    text: string,
    onError?: (context: TurnContext, error: Error) => Promise<void>
  ): Promise<{ id?: string }> {
    const response: { id?: string } = {};
    await this.parent.adapter.continueConversation(
      this.parent.conversationReference as ConversationReference,
      async (context) => {
        const conversation = await this.newConversation(context);
        await this.parent.adapter.continueConversation(conversation, async (ctx: TurnContext) => {
          try {
            const res = await ctx.sendActivity(text);
            response.id = res?.id;
          } catch (error) {
            if (onError) {
              await onError(ctx, error as Error);
            } else {
              throw error;
            }
          }
        });
      }
    );
    return response;
  }

  /**
   * Send an adaptive card message.
   *
   * @param card - The adaptive card raw JSON.
   * @param onError - An optional error handler that can catch exceptions during adaptive card sending.
   * If not defined, error will be handled by `BotAdapter.onTurnError`.
   *
   * @returns The response of sending adaptive card message.
   */
  public async sendAdaptiveCard(
    card: unknown,
    onError?: (context: TurnContext, error: Error) => Promise<void>
  ): Promise<{ id?: string }> {
    const response: { id?: string } = {};
    await this.parent.adapter.continueConversation(
      this.parent.conversationReference as ConversationReference,
      async (context) => {
        const conversation = await this.newConversation(context);
        await this.parent.adapter.continueConversation(conversation, async (ctx: TurnContext) => {
          try {
            const res = await ctx.sendActivity({
              attachments: [CardFactory.adaptiveCard(card)],
              type: ActivityTypes.Message,
            } as Activity);
            response.id = res?.id;
          } catch (error) {
            if (onError) {
              await onError(ctx, error as Error);
            } else {
              throw error;
            }
          }
        });
      },
      true
    );
    return response;
  }

  /**
   * @internal
   */
  private async newConversation(context: TurnContext): Promise<ConversationReference> {
    const reference = context.activity.getConversationReference();
    const personalConversation = JSON.parse(JSON.stringify(reference));

    const connectorClient: ConnectorClient = context.turnState.get(
      this.parent.adapter.ConnectorClientKey
    ) ?? this.parent.adapter.connectorClient;

    const conversationParams: ConversationParameters = {
      members: [this.account],
      isGroup: false,
      agent: context.activity.recipient!,
      tenantId: context.activity.conversation!.tenantId,
      activity: undefined,
      channelData: context.activity.channelData ?? {},
    };
    const conversation = await connectorClient.createConversationAsync(conversationParams);
    personalConversation.conversation.id = conversation.id;

    return personalConversation;
  }
}

/**
 * A {@link NotificationTarget} that represents a bot installation. Teams Bot could be installed into
 * - Personal chat
 * - Group chat
 * - Team (by default the `General` channel)
 *
 * @remarks
 * It's recommended to get bot installations from {@link ConversationBot.installations()}.
 */
export class TeamsBotInstallation implements NotificationTarget {
  /**
   * The bound `CloudAdapter`.
   */
  public readonly adapter: CloudAdapter;

  /**
   * The bound `ConversationReference`.
   */
  public readonly conversationReference: Partial<ConversationReference>;

  /**
   * The bot app id.
   */
  public readonly botAppId: string;
  /**
   * Notification target type.
   *
   * @remarks
   * - "Channel" means bot is installed into a team and notification will be sent to its "General" channel.
   * - "Group" means bot is installed into a group chat.
   * - "Person" means bot is installed into a personal scope and notification will be sent to personal chat.
   */
  public readonly type?: string;

  /**
   * Constructor
   *
   * @remarks
   * It's recommended to get bot installations from {@link ConversationBot.installations()}, instead of using this constructor.
   *
   * @param adapter - The bound `CloudAdapter`.
   * @param conversationReference - The bound `ConversationReference`.
   * @param botAppId - The bot app id.
   */
  constructor(
    adapter: CloudAdapter,
    conversationReference: Partial<ConversationReference>,
    botAppId: string
  ) {
    this.adapter = adapter;
    this.conversationReference = conversationReference;
    this.type = conversationReference.conversation.conversationType;
    this.botAppId = botAppId;
  }

  /**
   * Send a plain text message.
   *
   * @param text - The plain text message.
   * @param onError - An optional error handler that can catch exceptions during message sending.
   * If not defined, error will be handled by `BotAdapter.onTurnError`.
   *
   * @returns The response of sending message.
   */
  public async sendMessage(
    text: string,
    onError?: (context: TurnContext, error: Error) => Promise<void>
  ): Promise<{ id?: string }> {
    const response: { id?: string } = {};
    await this.adapter.continueConversation(
      this.conversationReference as ConversationReference,
      async (context) => {
        try {
          const res = await context.sendActivity(text);
          response.id = res?.id;
        } catch (error) {
          if (onError) {
            await onError(context, error as Error);
          } else {
            throw error;
          }
        }
      }
    );
    return response;
  }

  /**
   * Send an adaptive card message.
   *
   * @param card - The adaptive card raw JSON.
   * @param onError - An optional error handler that can catch exceptions during adaptive card sending.
   * If not defined, error will be handled by `BotAdapter.onTurnError`.
   *
   * @returns The response of sending adaptive card message.
   */
  public async sendAdaptiveCard(
    card: unknown,
    onError?: (context: TurnContext, error: Error) => Promise<void>
  ): Promise<{ id?: string }> {
    const response: { id?: string } = {};
    await this.adapter.continueConversation(
      this.conversationReference as ConversationReference,
      async (context) => {
        try {
          const adaptiveCard = {
            attachments: [CardFactory.adaptiveCard(card)],
            type: ActivityTypes.Message,
          } as Activity;
          const res = await context.sendActivity(adaptiveCard);
          response.id = res?.id;
        } catch (error) {
          if (onError) {
            await onError(context, error as Error);
          } else {
            throw error;
          }
        }
      },
      true
    );
    return response;
  }

  /**
   * Get channels from this bot installation.
   *
   * @returns An array of channels if bot is installed into a team, otherwise returns an empty array.
   */
  public async channels(): Promise<Channel[]> {
    const channels: Channel[] = [];
    if (this.type !== "channel") {
      return channels;
    }

    let teamsChannels: ChannelInfo[] = [];
    await this.adapter.continueConversation(
      this.conversationReference as ConversationReference,
      async (context) => {
        const teamId = getTeamsBotInstallationId(context);
        if (teamId !== undefined) {
          teamsChannels = await TeamsInfo.getTeamChannels(context, teamId);
        }
      }
    );

    for (const channel of teamsChannels) {
      channels.push(new Channel(this, channel));
    }

    return channels;
  }

  /**
   * Gets a pagined list of members from this bot installation.
   *
   * @param pageSize - Suggested number of entries on a page.
   * @param continuationToken - A continuation token.
   * @returns An array of members from where the bot is installed.
   */
  public async getPagedMembers(
    pageSize?: number,
    continuationToken?: string
  ): Promise<PagedData<Member>> {
    let result: PagedData<Member> = {
      data: [],
      continuationToken: "",
    };

    await this.adapter.continueConversation(
      this.conversationReference as ConversationReference,
      async (context) => {
        context.activity.channelData = context.activity.channelData ?? {};
          if (context.turnState.get('connectorClient') === undefined) {
            context.turnState.set('connectorClient', this.adapter.connectorClient);
          }
        const pagedMembers = await TeamsInfo.getPagedMembers(context, pageSize, continuationToken);

        result = {
          data: pagedMembers.members.map((m) => new Member(this, m)),
          continuationToken: pagedMembers.continuationToken,
        };
      },
      true
    );

    return result;
  }

  /**
   * Get team details from this bot installation
   *
   * @returns The team details if bot is installed into a team, otherwise returns `undefined`.
   */
  public async getTeamDetails(): Promise<TeamDetails | undefined> {
    if (this.type !== "channel") {
      return undefined;
    }

    let teamDetails: TeamDetails | undefined;
    await this.adapter.continueConversation(
      this.conversationReference as ConversationReference,
      async (context) => {
        const teamId = getTeamsBotInstallationId(context);
        if (teamId !== undefined) {
          teamDetails = await TeamsInfo.getTeamDetails(context, teamId);
        }
      }
    );

    return teamDetails;
  }
}

/**
 * Provide utilities to send notification to varies targets (e.g., member, group, channel).
 */
export class NotificationBot {
  private readonly conversationReferenceStore: IStorage;
  private readonly adapter: CloudAdapter;
  private readonly botAppId: string;

  /**
   * Constructor of the notification bot.
   *
   * @remarks
   * To ensure accuracy, it's recommended to initialize before handling any message.
   *
   * @param adapter - The bound `CloudAdapter`
   * @param options - The initialize options
   */
  public constructor(adapter: CloudAdapter, store: IStorage, botAppId: string) {
    this.conversationReferenceStore = store;

    this.adapter = adapter.use(new NotificationMiddleware(this.conversationReferenceStore));
    this.botAppId = botAppId;
  }

  /**
   * Create a {@link TeamsBotInstallation} instance with conversation reference.
   *
   * @param conversationReference - The bound `ConversationReference`.
   * @returns - The {@link TeamsBotInstallation} instance or null.
   */
  public buildTeamsBotInstallation(
    conversationReference: Partial<ConversationReference>
  ): TeamsBotInstallation | null {
    if (!conversationReference) {
      throw new Error("conversationReference is required.");
    }

    return new TeamsBotInstallation(this.adapter, conversationReference, this.botAppId);
  }

  /**
   * Validate the installation by getting paged memebers.
   *
   * @param conversationReference The bound `ConversationReference`.
   * @returns Returns false if recieves `BotNotInConversationRoster` error, otherwise returns true.
   */
  public async validateInstallation(
    conversationReference: Partial<ConversationReference>
  ): Promise<boolean> {
    let isValid = true;
    await this.adapter.continueConversation(
      conversationReference as ConversationReference,
      async (context) => {
        try {
          // try get member to see if the installation is still valid
          context.activity.channelData = context.activity.channelData ?? {};
          context.turnState.set('connectorClient', this.adapter.connectorClient);
          await TeamsInfo.getPagedMembers(context, 1);
        } catch (error: any) {
          if ((error.code as string) === "BotNotInConversationRoster") {
            isValid = false;
          }
        }
      }
    );
    return isValid;
  }

  /**
   * Gets a pagined list of targets where the bot is installed.
   *
   * @remarks
   * The result is retrieving from the persisted storage.
   *
   * @param pageSize - Suggested number of entries on a page.
   * @param continuationToken - A continuation token.
   *
   * @returns An array of {@link TeamsBotInstallation} with paged data and continuation token.
   */
  public async getPagedInstallations(
    pageSize?: number,
    continuationToken?: string,
    validationEnabled = true
  ): Promise<PagedData<TeamsBotInstallation>> {
    if (this.conversationReferenceStore === undefined || this.adapter === undefined) {
      throw new Error("NotificationBot has not been initialized.");
    }

    const references = await this.conversationReferenceStore.list(pageSize, continuationToken);
    const targets: TeamsBotInstallation[] = [];
    for (const reference of references.data) {
      // validate connection
      let valid;
      if (validationEnabled) {
        // try get member to see if the installation is still valid
        valid = await this.validateInstallation(reference);
      }

      if (!validationEnabled || valid) {
        targets.push(new TeamsBotInstallation(this.adapter, reference, this.botAppId));
      } else {
        await this.conversationReferenceStore.delete([getKey(reference)]);
      }
    }

    return {
      data: targets,
      continuationToken: references.continuationToken,
    };
  }

  /**
   * Return the first {@link Member} where predicate is true, and undefined otherwise.
   *
   * @param predicate - Find calls predicate once for each member of the installation,
   * until it finds one where predicate returns true. If such a member is found, find
   * immediately returns that member. Otherwise, find returns undefined.
   * @param scope - The scope to find members from the installations
   * (personal chat, group chat, Teams channel).
   *
   * @returns The first {@link Member} where predicate is true, and `undefined` otherwise.
   */
  public async findMember(
    predicate: (member: Member) => Promise<boolean>,
    scope?: SearchScope
  ): Promise<Member | undefined> {
    for (const target of await this.installations()) {
      if (this.matchSearchScope(target, scope)) {
        const members: Member[] = [];
        let continuationToken: string | undefined;
        do {
          const pagedData = await target.getPagedMembers(undefined, continuationToken);
          continuationToken = pagedData.continuationToken;
          members.push(...pagedData.data);
        } while (continuationToken);

        for (const member of members) {
          if (await predicate(member)) {
            return member;
          }
        }
      }
    }

    return;
  }

  /**
   * Return the first {@link Channel} where predicate is true, and undefined otherwise.
   * (Ensure the bot app is installed into the `General` channel, otherwise undefined will be returned.)
   *
   * @param predicate - Find calls predicate once for each channel of the installation,
   * until it finds one where predicate returns true. If such a channel is found, find
   * immediately returns that channel. Otherwise, find returns `undefined`.
   *
   * @returns The first {@link Channel} where predicate is true, and `undefined` otherwise.
   */
  public async findChannel(
    predicate: (channel: Channel, teamDetails: TeamDetails | undefined) => Promise<boolean>
  ): Promise<Channel | undefined> {
    for (const target of await this.installations()) {
      if (target.type === "channel") {
        const teamDetails = await target.getTeamDetails();
        for (const channel of await target.channels()) {
          if (await predicate(channel, teamDetails)) {
            return channel;
          }
        }
      }
    }

    return;
  }

  /**
   * Return all {@link Member} where predicate is true, and empty array otherwise.
   *
   * @param predicate - Find calls predicate for each member of the installation.
   * @param scope - The scope to find members from the installations
   * (personal chat, group chat, Teams channel).
   *
   * @returns An array of {@link Member} where predicate is true, and empty array otherwise.
   */
  public async findAllMembers(
    predicate: (member: Member) => Promise<boolean>,
    scope?: SearchScope
  ): Promise<Member[]> {
    const members: Member[] = [];
    for (const target of await this.installations()) {
      if (this.matchSearchScope(target, scope)) {
        const targetMembers: Member[] = [];
        let continuationToken: string | undefined;
        do {
          const pagedData = await target.getPagedMembers(undefined, continuationToken);
          continuationToken = pagedData.continuationToken;
          targetMembers.push(...pagedData.data);
        } while (continuationToken);

        for (const member of targetMembers) {
          if (await predicate(member)) {
            members.push(member);
          }
        }
      }
    }

    return members;
  }

  /**
   * Return all {@link Channel} where predicate is true, and empty array otherwise.
   * (Ensure the bot app is installed into the `General` channel, otherwise empty array will be returned.)
   *
   * @param predicate - Find calls predicate for each channel of the installation.
   *
   * @returns An array of {@link Channel} where predicate is true, and empty array otherwise.
   */
  public async findAllChannels(
    predicate: (channel: Channel, teamDetails: TeamDetails | undefined) => Promise<boolean>
  ): Promise<Channel[]> {
    const channels: Channel[] = [];
    for (const target of await this.installations()) {
      if (target.type === "channel") {
        const teamDetails = await target.getTeamDetails();
        for (const channel of await target.channels()) {
          if (await predicate(channel, teamDetails)) {
            channels.push(channel);
          }
        }
      }
    }

    return channels;
  }

  private matchSearchScope(target: NotificationTarget, scope?: SearchScope): boolean {
    scope = scope ?? SearchScope.All;

    return (
      (target.type === "channel" && (scope & SearchScope.Channel) !== 0) ||
      (target.type === "groupChat" && (scope & SearchScope.Group) !== 0) ||
      (target.type === "personal" && (scope & SearchScope.Person) !== 0)
    );
  }

  /**
   * @internal
   * Get all targets where the bot is installed.
   *
   * @remarks
   * The result is retrieving from the persisted storage.
   *
   * @returns An array of {@link TeamsBotInstallation}
   */
  private async installations(): Promise<TeamsBotInstallation[]> {
    let continuationToken: string | undefined;
    const targets: TeamsBotInstallation[] = [];
    do {
      const result = await this.getPagedInstallations(undefined, continuationToken);
      continuationToken = result.continuationToken;
      targets.push(...result.data);
    } while (continuationToken);

    return targets;
  }
}

/**
 * The search scope when calling {@link NotificationBot.findMember} and {@link NotificationBot.findAllMembers}.
 * The search scope is a flagged enum and it can be combined with `|`.
 * For example, to search from personal chat and group chat, use `SearchScope.Person | SearchScope.Group`.
 */
export enum SearchScope {
  /**
   * Search members from the installations in personal chat only.
   */
  Person = 1,

  /**
   * Search members from the installations in group chat only.
   */
  Group = 2,

  /**
   * Search members from the installations in Teams channel only.
   */
  Channel = 4,

  /**
   * Search members from all installations including personal chat, group chat and Teams channel.
   */
  All = Person | Group | Channel,
}
