export type RoleId = 'villager' | 'werewolf' | 'seer' | 'robber' | 'minion' | 'tanner';

export type Team = 'village' | 'werewolf' | 'tanner';

export type GamePhase = 'lobby' | 'night' | 'discussion' | 'vote' | 'result';

export type DiscussionDuration = 180 | 300 | 0;

export type NightActionKind = 'none' | 'seer-player' | 'seer-center' | 'robber' | 'werewolf-peek';

export type VoteMap = Record<string, string>;

export type Player = {
  uid: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  isCpu?: boolean;
  joinedAt: number;
};

export type PlayerMap = Record<string, Player>;

export type RoleCounts = Record<RoleId, number>;

export type RoomSettings = {
  discussionDuration: DiscussionDuration;
  roleCounts: RoleCounts;
  soloWerewolfCanPeekCenter: boolean;
  martyrMode: boolean;
};

export type NightAction = {
  actorUid: string;
  kind: NightActionKind;
  targetUid?: string;
  createdAt: number;
};

export type ExchangeLog = {
  order: number;
  roleId: RoleId;
  actorUid: string;
  targetUid: string;
};

export type PublicReveal = {
  uid: string;
  initialRole: RoleId;
  finalRole: RoleId;
};

export type GameResult = {
  executedUids: string[];
  winningUids?: string[];
  winningTeams: Team[];
  reason: string;
  isPeacefulVillage?: boolean;
  reveals: PublicReveal[];
  exchangeLogs: ExchangeLog[];
};

export type Room = {
  code: string;
  hostUid: string;
  phase: GamePhase;
  players: PlayerMap;
  settings: RoomSettings;
  createdAt: number;
  startedAt?: number;
  discussionStartedAt?: number;
  voteStartedAt?: number;
  result?: GameResult;
  votes?: VoteMap;
  nightDone?: Record<string, boolean>;
};

export type PrivatePlayerState = {
  uid: string;
  initialRole: RoleId;
  finalRole: RoleId;
  centerCards?: RoleId[];
  roleOptions?: Record<string, RoleId>;
  werewolfPartners?: string[];
  soloWerewolfPeek?: RoleId;
  nightAction?: NightAction;
  seen?: Array<{ label: string; roleId: RoleId; targetUid?: string }>;
};
