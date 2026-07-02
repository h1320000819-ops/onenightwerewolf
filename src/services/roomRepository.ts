import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  applyNightActions,
  buildSeenInfo,
  createDefaultSettings,
  createRoomCode,
  dealPrivateStates,
  judgeGame,
  NO_VOTE_TARGET,
  normalizeRoleCounts,
} from '../domain/gameLogic';
import type { DiscussionDuration, NightAction, Player, PrivatePlayerState, RoleCounts, Room } from '../domain/types';
import { supabase } from './supabase';

type RoomRow = {
  code: string;
  data: Room;
};

type PrivateStateRow = {
  room_code: string;
  uid: string;
  data: PrivatePlayerState;
};

const upperCode = (code: string) => code.trim().toUpperCase();

const fetchRoom = async (code: string) => {
  const { data, error } = await supabase.from('rooms').select('code,data').eq('code', upperCode(code)).maybeSingle<RoomRow>();
  if (error?.code === 'PGRST205') throw new Error('Supabaseのテーブルが未作成です。supabase/schema.sql をSQL Editorで実行してください。');
  if (error) throw error;
  return data?.data;
};

const saveRoom = async (room: Room) => {
  const { error } = await supabase.from('rooms').update({ data: room }).eq('code', room.code);
  if (error) throw error;
};

const upsertPrivateState = async (code: string, state: PrivatePlayerState) => {
  const { error } = await supabase
    .from('private_states')
    .upsert({ room_code: upperCode(code), uid: state.uid, data: state }, { onConflict: 'room_code,uid' });
  if (error) throw error;
};

const fetchPrivateState = async (code: string, uid: string) => {
  const { data, error } = await supabase
    .from('private_states')
    .select('room_code,uid,data')
    .eq('room_code', upperCode(code))
    .eq('uid', uid)
    .maybeSingle<PrivateStateRow>();
  if (error) throw error;
  return data?.data;
};

const fetchPrivateStates = async (code: string) => {
  const { data, error } = await supabase.from('private_states').select('room_code,uid,data').eq('room_code', upperCode(code)).returns<PrivateStateRow[]>();
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((row) => [row.uid, row.data]));
};

const pickRandom = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

const createCpuNightAction = (state: PrivatePlayerState, room: Room): NightAction | undefined => {
  const candidates = Object.keys(room.players).filter((uid) => uid !== state.uid);
  if (state.initialRole === 'robber' && candidates.length > 0) {
    return { actorUid: state.uid, kind: 'robber', targetUid: pickRandom(candidates), createdAt: Date.now() };
  }
  if (state.initialRole === 'seer') {
    if (Math.random() < 0.5 || candidates.length === 0) {
      return { actorUid: state.uid, kind: 'seer-center', createdAt: Date.now() };
    }
    return { actorUid: state.uid, kind: 'seer-player', targetUid: pickRandom(candidates), createdAt: Date.now() };
  }
  if (state.initialRole === 'werewolf') {
    return state.soloWerewolfPeek ? { actorUid: state.uid, kind: 'werewolf-peek', createdAt: Date.now() } : undefined;
  }
  return undefined;
};

export const subscribeRoom = (code: string, callback: (room?: Room) => void) => {
  const roomCode = upperCode(code);

  fetchRoom(roomCode).then(callback).catch(() => callback(undefined));
  const channel: RealtimeChannel = supabase
    .channel(`room:${roomCode}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${roomCode}` },
      (payload) => callback((payload.new as RoomRow | undefined)?.data),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
};

export const subscribePrivateState = (code: string, uid: string, callback: (state?: PrivatePlayerState) => void) => {
  const roomCode = upperCode(code);

  fetchPrivateState(roomCode, uid).then(callback).catch(() => callback(undefined));
  const channel: RealtimeChannel = supabase
    .channel(`private-state:${roomCode}:${uid}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'private_states', filter: `room_code=eq.${roomCode}` },
      (payload) => {
        const row = payload.new as PrivateStateRow | undefined;
        if (row?.uid === uid) callback(row.data);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
};

export const createRoom = async (uid: string, name: string) => {
  let code = createRoomCode();
  while (await fetchRoom(code)) code = createRoomCode();

  const player: Player = { uid, name, isHost: true, isReady: true, joinedAt: Date.now() };
  const room: Room = {
    code,
    hostUid: uid,
    phase: 'lobby',
    players: { [uid]: player },
    settings: createDefaultSettings(),
    createdAt: Date.now(),
    nightDone: {},
    votes: {},
  };

  const { error } = await supabase.from('rooms').insert({ code, data: room });
  if (error) throw error;
  return code;
};

export const joinRoom = async (code: string, uid: string, name: string) => {
  const room = await fetchRoom(code);
  if (!room) throw new Error('ルームが見つかりません。');
  if (room.phase !== 'lobby' && !room.players[uid]) throw new Error('開始済みのルームには新規参加できません。');

  const player: Player = { uid, name, isHost: room.hostUid === uid, isReady: false, joinedAt: Date.now() };
  await saveRoom({ ...room, players: { ...room.players, [uid]: room.players[uid] ?? player } });
};

export const setReady = async (code: string, uid: string, ready: boolean) => {
  const room = await fetchRoom(code);
  if (!room || !room.players[uid]) return;
  await saveRoom({ ...room, players: { ...room.players, [uid]: { ...room.players[uid], isReady: ready } } });
};

export const addCpuPlayer = async (room: Room) => {
  const cpuNumber = Object.values(room.players).filter((player) => player.isCpu).length + 1;
  const cpuUid = `cpu_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const cpu: Player = {
    uid: cpuUid,
    name: `CPU ${cpuNumber}`,
    isHost: false,
    isReady: true,
    isCpu: true,
    joinedAt: Date.now(),
  };
  const players = { ...room.players, [cpuUid]: cpu };
  await saveRoom({
    ...room,
    players,
    settings: {
      ...room.settings,
      roleCounts: normalizeRoleCounts(room.settings.roleCounts, Object.keys(players).length),
    },
  });
};

export const removeCpuPlayer = async (room: Room, cpuUid: string) => {
  if (!room.players[cpuUid]?.isCpu) return;
  const players = { ...room.players };
  delete players[cpuUid];
  await saveRoom({
    ...room,
    players,
    settings: {
      ...room.settings,
      roleCounts: normalizeRoleCounts(room.settings.roleCounts, Object.keys(players).length),
    },
  });
};

export const updateSettings = async (
  code: string,
  discussionDuration: DiscussionDuration,
  roleCounts: RoleCounts,
  playerCount: number,
  soloWerewolfCanPeekCenter: boolean,
  martyrMode: boolean,
) => {
  const room = await fetchRoom(code);
  if (!room) return;
  await saveRoom({
    ...room,
    settings: {
      discussionDuration,
      roleCounts: normalizeRoleCounts(roleCounts, playerCount),
      soloWerewolfCanPeekCenter,
      martyrMode,
    },
  });
};

export const startGame = async (room: Room) => {
  const normalizedSettings = {
    ...room.settings,
    soloWerewolfCanPeekCenter: room.settings.soloWerewolfCanPeekCenter !== false,
    martyrMode: room.settings.martyrMode === true,
    roleCounts: normalizeRoleCounts(room.settings.roleCounts, Object.keys(room.players).length),
  };
  const privateStates = dealPrivateStates(room.players, normalizedSettings);
  const cpuNightDone: Record<string, boolean> = {};
  Object.values(room.players).forEach((player) => {
    const state = privateStates[player.uid];
    if (!state) return;
    if (player.isCpu) {
      const action = createCpuNightAction(state, room);
      privateStates[player.uid] = {
        ...state,
        nightAction: action,
        seen: action ? buildSeenInfo(state, action, room.players) : [],
      };
      cpuNightDone[player.uid] = true;
    }
  });
  await Promise.all(Object.values(privateStates).map((state) => upsertPrivateState(room.code, state)));
  await saveRoom({
    ...room,
    settings: normalizedSettings,
    phase: 'night',
    startedAt: Date.now(),
    nightDone: cpuNightDone,
    votes: {},
    result: undefined,
  });
};

export const submitNightAction = async (code: string, _uid: string, action: NightAction, state: PrivatePlayerState, players: Room['players']) => {
  const seen = buildSeenInfo(state, action, players);
  await upsertPrivateState(code, { ...state, nightAction: action, seen });
};

export const skipNightAction = async (code: string, uid: string) => {
  const room = await fetchRoom(code);
  if (!room) return;
  await saveRoom({ ...room, nightDone: { ...(room.nightDone ?? {}), [uid]: true } });
};

export const finishNight = async (code: string) => {
  const room = await fetchRoom(code);
  if (!room) return;
  await saveRoom({ ...room, phase: 'discussion', discussionStartedAt: Date.now() });
};

export const startVote = async (code: string) => {
  const room = await fetchRoom(code);
  if (!room) return;
  await saveRoom({ ...room, phase: 'vote', voteStartedAt: Date.now(), votes: {} });
};

export const submitVote = async (code: string, uid: string, targetUid: string) => {
  const room = await fetchRoom(code);
  if (!room) return;
  await saveRoom({ ...room, votes: { ...(room.votes ?? {}), [uid]: targetUid } });
};

export const submitCpuVotes = async (room: Room) => {
  const votes = { ...(room.votes ?? {}) };
  let changed = false;
  Object.values(room.players)
    .filter((player) => player.isCpu && !votes[player.uid])
    .forEach((cpu) => {
      const targets = [...Object.keys(room.players).filter((uid) => uid !== cpu.uid), NO_VOTE_TARGET];
      if (targets.length === 0) return;
      votes[cpu.uid] = pickRandom(targets);
      changed = true;
    });
  if (changed) await saveRoom({ ...room, votes });
};

export const revealResults = async (room: Room) => {
  const states = await fetchPrivateStates(room.code);
  const actions = Object.values(states)
    .map((state) => state.nightAction)
    .filter(Boolean) as NightAction[];
  const { finalStates, exchangeLogs } = applyNightActions(states, actions);
  const result = judgeGame(finalStates, room.votes ?? {}, exchangeLogs, room.settings);
  await Promise.all(Object.values(finalStates).map((state) => upsertPrivateState(room.code, state)));
  await saveRoom({ ...room, phase: 'result', result });
};

export const resetRoom = async (room: Room) => {
  await supabase.from('private_states').delete().eq('room_code', room.code);
  await saveRoom({ ...room, phase: 'lobby', nightDone: {}, votes: {}, result: undefined });
};

export const leaveRoom = async (room: Room, uid: string) => {
  await supabase.from('private_states').delete().eq('room_code', room.code).eq('uid', uid);
  const players = { ...room.players };
  delete players[uid];
  const remainingPlayers = Object.values(players);
  let hostUid = room.hostUid;
  if (room.hostUid === uid && remainingPlayers.length > 0) {
    const nextHost = remainingPlayers.find((player) => !player.isCpu) ?? remainingPlayers[0];
    hostUid = nextHost.uid;
    players[nextHost.uid] = { ...players[nextHost.uid], isHost: true };
  }
  await saveRoom({ ...room, hostUid, players });
};
