import { DEFAULT_ROLE_COUNTS, ROLE_DEFINITIONS, roleTeam, rolesFromCounts } from './roles/Role';
import type {
  ExchangeLog,
  GameResult,
  NightAction,
  PlayerMap,
  PrivatePlayerState,
  PublicReveal,
  RoleCounts,
  RoleId,
  RoomSettings,
  Team,
  VoteMap,
} from './types';

export const NO_VOTE_TARGET = '__none__';

export const createRoomCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
};

export const createDefaultSettings = (): RoomSettings => ({
  discussionDuration: 300,
  roleCounts: DEFAULT_ROLE_COUNTS,
  soloWerewolfCanPeekCenter: true,
  martyrMode: false,
});

export const ensureDeckSize = (counts: RoleCounts, playerCount: number) => rolesFromCounts(counts).length === playerCount + 2;

export const normalizeRoleCounts = (counts: RoleCounts, playerCount: number): RoleCounts => {
  const next = { ...counts };
  const reductionOrder: RoleId[] = ['villager', 'tanner', 'minion', 'robber', 'seer', 'werewolf'];
  while (rolesFromCounts(next).length < playerCount + 2) next.villager += 1;
  while (rolesFromCounts(next).length > playerCount + 2) {
    const removableRole = reductionOrder.find((roleId) => next[roleId] > (roleId === 'werewolf' ? 1 : 0));
    if (!removableRole) break;
    next[removableRole] -= 1;
  }
  return next;
};

const shuffle = <T,>(items: T[]) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

export const dealPrivateStates = (players: PlayerMap, settings: RoomSettings): Record<string, PrivatePlayerState> => {
  const playerIds = Object.keys(players);
  const deck = shuffle(rolesFromCounts(settings.roleCounts));
  const centerCards = deck.slice(playerIds.length) as RoleId[];
  const initialByUid = Object.fromEntries(playerIds.map((uid, index) => [uid, deck[index] as RoleId]));
  const werewolves = playerIds.filter((uid) => initialByUid[uid] === 'werewolf');

  return Object.fromEntries(
    playerIds.map((uid) => {
      const initialRole = initialByUid[uid];
      const roleOptions = Object.fromEntries(playerIds.filter((id) => id !== uid).map((id) => [id, initialByUid[id]]));
      return [
        uid,
        {
          uid,
          initialRole,
          finalRole: initialRole,
          centerCards,
          roleOptions,
          werewolfPartners: werewolves.filter((id) => id !== uid),
          soloWerewolfPeek: settings.soloWerewolfCanPeekCenter !== false && werewolves.length === 1 ? centerCards[0] : undefined,
          seen: [],
        } satisfies PrivatePlayerState,
      ];
    }),
  );
};

export const buildSeenInfo = (state: PrivatePlayerState, action: NightAction, players: PlayerMap) => {
  if (action.kind === 'seer-center') {
    return (state.centerCards ?? []).map((roleId, index) => ({ label: `中央${index + 1}`, roleId }));
  }
  if (action.kind === 'seer-player' && action.targetUid && state.roleOptions?.[action.targetUid]) {
    return [{ label: players[action.targetUid]?.name ?? 'プレイヤー', roleId: state.roleOptions[action.targetUid], targetUid: action.targetUid }];
  }
  if (action.kind === 'robber' && action.targetUid && state.roleOptions?.[action.targetUid]) {
    const targetName = players[action.targetUid]?.name ?? 'プレイヤー';
    return [{ label: `${targetName} と交換しました`, roleId: state.roleOptions[action.targetUid], targetUid: action.targetUid }];
  }
  if (action.kind === 'werewolf-peek' && state.soloWerewolfPeek) {
    return [{ label: '中央カード', roleId: state.soloWerewolfPeek }];
  }
  return [];
};

export const applyNightActions = (
  privateStates: Record<string, PrivatePlayerState>,
  actions: NightAction[],
): { finalStates: Record<string, PrivatePlayerState>; exchangeLogs: ExchangeLog[] } => {
  const finalStates = Object.fromEntries(
    Object.entries(privateStates).map(([uid, state]) => [uid, { ...state, finalRole: state.initialRole }]),
  );
  const exchangeLogs: ExchangeLog[] = [];

  actions
    .filter((action) => action.kind === 'robber' && action.targetUid)
    .sort((a, b) => ROLE_DEFINITIONS.robber.nightOrder - ROLE_DEFINITIONS.robber.nightOrder || a.createdAt - b.createdAt)
    .forEach((action, index) => {
      const actor = finalStates[action.actorUid];
      const target = action.targetUid ? finalStates[action.targetUid] : undefined;
      if (!actor || !target || actor.initialRole !== 'robber') return;
      const actorRole = actor.finalRole;
      actor.finalRole = target.finalRole;
      target.finalRole = actorRole;
      exchangeLogs.push({ order: index + 1, roleId: 'robber', actorUid: action.actorUid, targetUid: target.uid });
    });

  return { finalStates, exchangeLogs };
};

const getExecutedUids = (votes: VoteMap) => {
  const counts = Object.values(votes)
    .filter((uid) => uid !== NO_VOTE_TARGET)
    .reduce<Record<string, number>>((acc, uid) => {
      acc[uid] = (acc[uid] ?? 0) + 1;
      return acc;
    }, {});
  const maxVotes = Math.max(0, ...Object.values(counts));
  if (maxVotes === 0) return [];
  const tiedUids = Object.entries(counts)
    .filter(([, count]) => count === maxVotes)
    .map(([uid]) => uid);
  return tiedUids.length <= 2 ? tiedUids : [];
};

export const judgeGame = (
  privateStates: Record<string, PrivatePlayerState>,
  votes: VoteMap,
  exchangeLogs: ExchangeLog[],
  settings?: RoomSettings,
): GameResult => {
  const reveals: PublicReveal[] = Object.values(privateStates).map((state) => ({
    uid: state.uid,
    initialRole: state.initialRole,
    finalRole: state.finalRole,
  }));
  const executedUids = getExecutedUids(votes);
  const executedRoles = executedUids.map((uid) => privateStates[uid]?.finalRole).filter(Boolean) as RoleId[];
  const finalRoles = Object.values(privateStates).map((state) => state.finalRole);
  const hasWerewolf = finalRoles.includes('werewolf');
  const isPeacefulVillage = !hasWerewolf;
  const tannerExecuted = executedRoles.includes('tanner');
  const werewolfExecuted = executedRoles.includes('werewolf');
  let winningTeams: Team[];
  let winningUids: string[] | undefined;
  let reason: string;

  if (isPeacefulVillage && settings?.martyrMode) {
    winningTeams = [];
    winningUids = executedUids;
    reason = executedUids.length
      ? '殉教者モード: 平和村のため、処刑されたプレイヤーの勝利です。'
      : '殉教者モード: 平和村で誰も処刑されなかったため、勝者はいません。';
  } else if (tannerExecuted) {
    winningTeams = ['tanner'];
    reason = 'てるてるが処刑されたため、てるてる陣営の勝利です。';
  } else if (!hasWerewolf && executedUids.length === 0) {
    winningTeams = ['village'];
    reason = '場に人狼がおらず、誰も処刑されなかったため全員の勝ちです。';
  } else if (!hasWerewolf) {
    winningTeams = [];
    reason = '場に人狼がいないのに誰かを処刑したため全員負けです。';
  } else if (werewolfExecuted) {
    winningTeams = ['village'];
    reason = '人狼が1人以上処刑されたため、村人陣営の勝利です。';
  } else {
    winningTeams = ['werewolf'];
    reason = '人狼が1人も処刑されなかったため、人狼陣営の勝利です。';
  }

  return { executedUids, winningUids, winningTeams, reason, isPeacefulVillage, reveals, exchangeLogs };
};

export const visibleTeamName = (roleId: RoleId) => {
  const team = roleTeam(roleId);
  if (team === 'village') return '村人陣営';
  if (team === 'werewolf') return '人狼陣営';
  return 'てるてる陣営';
};
