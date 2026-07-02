import type { NightActionKind, RoleCounts, RoleId, Team } from '../types';

export type RoleDefinition = {
  id: RoleId;
  name: string;
  shortName: string;
  team: Team;
  nightOrder: number;
  description: string;
  actionKind: NightActionKind;
  hasNightAction: boolean;
};

export const ROLE_DEFINITIONS: Record<RoleId, RoleDefinition> = {
  villager: {
    id: 'villager',
    name: '村人',
    shortName: '村',
    team: 'village',
    nightOrder: 99,
    description: '特殊能力はありません。会話から人狼を探します。',
    actionKind: 'none',
    hasNightAction: false,
  },
  werewolf: {
    id: 'werewolf',
    name: '人狼',
    shortName: '狼',
    team: 'werewolf',
    nightOrder: 10,
    description: '仲間の人狼を確認します。1人だけなら中央カードを1枚見られます。',
    actionKind: 'werewolf-peek',
    hasNightAction: true,
  },
  seer: {
    id: 'seer',
    name: '占い師',
    shortName: '占',
    team: 'village',
    nightOrder: 20,
    description: '他プレイヤー1人、または中央カード2枚を見ることができます。',
    actionKind: 'seer-player',
    hasNightAction: true,
  },
  robber: {
    id: 'robber',
    name: '怪盗',
    shortName: '盗',
    team: 'village',
    nightOrder: 30,
    description: '他プレイヤー1人とカードを交換し、交換後の自分の役職を確認します。',
    actionKind: 'robber',
    hasNightAction: true,
  },
  minion: {
    id: 'minion',
    name: '狂人',
    shortName: '狂',
    team: 'werewolf',
    nightOrder: 40,
    description: '人狼陣営です。人狼が勝つように議論を誘導します。',
    actionKind: 'none',
    hasNightAction: false,
  },
  tanner: {
    id: 'tanner',
    name: 'てるてる',
    shortName: '照',
    team: 'tanner',
    nightOrder: 50,
    description: '処刑されることが勝利条件です。',
    actionKind: 'none',
    hasNightAction: false,
  },
};

export const DEFAULT_ROLE_COUNTS: RoleCounts = {
  villager: 3,
  werewolf: 2,
  seer: 1,
  robber: 1,
  minion: 1,
  tanner: 1,
};

export const roleList = Object.values(ROLE_DEFINITIONS).sort((a, b) => a.nightOrder - b.nightOrder);

export const roleName = (roleId: RoleId) => ROLE_DEFINITIONS[roleId].name;

export const roleTeam = (roleId: RoleId) => ROLE_DEFINITIONS[roleId].team;

export const rolesFromCounts = (counts: RoleCounts) =>
  roleList.flatMap((role) => Array.from({ length: counts[role.id] ?? 0 }, () => role.id));
