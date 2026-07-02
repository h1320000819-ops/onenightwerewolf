import { useEffect, useMemo, useState } from 'react';
import type { PrivatePlayerState, Room } from '../domain/types';
import { subscribePrivateState, subscribeRoom } from '../services/roomRepository';

export const useRoom = (code?: string, uid?: string) => {
  const [room, setRoom] = useState<Room>();
  const [privateState, setPrivateState] = useState<PrivatePlayerState>();

  useEffect(() => {
    if (!code) {
      setRoom(undefined);
      return undefined;
    }
    return subscribeRoom(code, setRoom);
  }, [code]);

  useEffect(() => {
    if (!code || !uid) {
      setPrivateState(undefined);
      return undefined;
    }
    return subscribePrivateState(code, uid, setPrivateState);
  }, [code, uid]);

  const players = useMemo(() => Object.values(room?.players ?? {}).filter(Boolean), [room?.players]);

  return { room, privateState, players };
};
