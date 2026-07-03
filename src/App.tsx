import { BarChart3, Bot, Check, Clipboard, Crown, LogOut, Moon, Play, RotateCcw, Send, Timer, Trash2, Users, Vote } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { NO_VOTE_TARGET, visibleTeamName } from './domain/gameLogic';
import { ROLE_DEFINITIONS, roleList, roleName, rolesFromCounts, roleTeam } from './domain/roles/Role';
import type { DiscussionDuration, NightAction, Player, PrivatePlayerState, RoleCounts, RoleId, Room } from './domain/types';
import { useAuth } from './hooks/useAuth';
import { useRoom } from './hooks/useRoom';
import {
  createRoom,
  finishNight,
  addCpuPlayer,
  joinRoom,
  leaveRoom,
  removeCpuPlayer,
  resetRoom,
  revealResults,
  setReady,
  skipNightAction,
  startGame,
  startNextGame,
  startVote,
  submitNightAction,
  submitCpuVotes,
  submitVote,
  updateSettings,
} from './services/roomRepository';
import { supabaseConfigured } from './services/supabase';
import { cn } from './utils/className';

const durationOptions: Array<{ label: string; value: DiscussionDuration }> = [
  { label: '3分', value: 180 },
  { label: '5分', value: 300 },
  { label: '無制限', value: 0 },
];

const roleCountOptions: Array<{ roleId: Exclude<RoleId, 'villager'>; label: string; options: number[] }> = [
  { roleId: 'werewolf', label: '人狼', options: [1, 2, 3] },
  { roleId: 'seer', label: '占い師', options: [1, 2, 3] },
  { roleId: 'robber', label: '怪盗', options: [1, 2] },
  { roleId: 'minion', label: '狂人', options: [0, 1, 2, 3] },
  { roleId: 'tanner', label: 'てるてる', options: [0, 1, 2] },
];

const withAutoVillagers = (counts: RoleCounts, requiredDeckSize: number): RoleCounts => {
  const fixedRoleTotal = roleCountOptions.reduce((sum, option) => sum + (counts[option.roleId] ?? 0), 0);
  return { ...counts, villager: Math.max(0, requiredDeckSize - fixedRoleTotal) };
};

const ROLE_IMAGES: Partial<Record<keyof typeof ROLE_DEFINITIONS, string>> = {
  villager: '/roles/villager.png',
  werewolf: '/roles/werewolf.png',
  seer: '/roles/seer.png',
  robber: '/roles/robber.png',
  minion: '/roles/minion.png',
  tanner: '/roles/tanner.png',
};

const resultImageFor = (result: NonNullable<Room['result']>) => {
  const peacefulVillage = result.isPeacefulVillage ?? !result.reveals.some((reveal) => reveal.finalRole === 'werewolf');
  const noWinner = result.winningTeams.length === 0 && (result.winningUids?.length ?? 0) === 0;
  if (noWinner) return '/roles/all-lose.png';
  if ((result.winningUids?.length ?? 0) > 0) return '/roles/martyr-win.png';
  if (result.winningTeams.includes('tanner')) return '/roles/tanner-win.png';
  if (result.winningTeams.includes('werewolf')) return '/roles/werewolf-win.png';
  if (peacefulVillage) return '/roles/peaceful-village.png';
  if (result.winningTeams.includes('village')) return '/roles/village-win.png';
  return undefined;
};

const playerNameFallback = () => `旅人${Math.floor(Math.random() * 900 + 100)}`;

type RoleStat = { games: number; wins: number };
type PlayerStats = { total: RoleStat; roles: Record<RoleId, RoleStat> };

const emptyRoleStat = (): RoleStat => ({ games: 0, wins: 0 });

const emptyStats = (): PlayerStats => ({
  total: emptyRoleStat(),
  roles: Object.fromEntries(roleList.map((role) => [role.id, emptyRoleStat()])) as Record<RoleId, RoleStat>,
});

const statsKey = (uid: string) => `onenight-stats:${uid}`;
const recordedRoundKey = (uid: string, room: Room) => `onenight-stats-recorded:${uid}:${room.code}:${room.startedAt ?? 'round'}`;

const loadStats = (uid: string): PlayerStats => {
  const raw = localStorage.getItem(statsKey(uid));
  if (!raw) return emptyStats();
  try {
    const parsed = JSON.parse(raw) as PlayerStats;
    const base = emptyStats();
    return {
      total: parsed.total ?? base.total,
      roles: { ...base.roles, ...(parsed.roles ?? {}) },
    };
  } catch {
    return emptyStats();
  }
};

const saveStats = (uid: string, stats: PlayerStats) => localStorage.setItem(statsKey(uid), JSON.stringify(stats));

const rateText = (stat: RoleStat) => (stat.games === 0 ? '-' : `${Math.round((stat.wins / stat.games) * 100)}% (${stat.wins}/${stat.games})`);

const recordResultStats = (uid: string, room: Room) => {
  const result = room.result;
  if (!result || localStorage.getItem(recordedRoundKey(uid, room))) return;
  const reveal = result.reveals.find((item) => item.uid === uid);
  if (!reveal) return;
  const won =
    result.winningUids?.includes(uid) ??
    (result.winningTeams.length > 0 && result.winningTeams.includes(roleTeam(reveal.finalRole)));
  const stats = loadStats(uid);
  stats.total.games += 1;
  if (won) stats.total.wins += 1;
  stats.roles[reveal.initialRole].games += 1;
  if (won) stats.roles[reveal.initialRole].wins += 1;
  saveStats(uid, stats);
  localStorage.setItem(recordedRoundKey(uid, room), '1');
};

const Button = ({
  children,
  variant = 'primary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) => (
  <button
    className={cn(
      'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
      variant === 'primary' && 'bg-red-900 text-amber-50 shadow-lg shadow-red-950/30 hover:bg-red-800',
      variant === 'secondary' && 'border border-amber-700/40 bg-stone-900/70 text-amber-100 hover:bg-stone-800',
      variant === 'ghost' && 'text-amber-100 hover:bg-amber-100/10',
      className,
    )}
    {...props}
  >
    {children}
  </button>
);

const errorMessage = (cause: unknown) => {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === 'object') {
    const maybeError = cause as { message?: unknown; details?: unknown; code?: unknown };
    return [maybeError.message, maybeError.details, maybeError.code].filter(Boolean).join(' / ') || '操作に失敗しました。';
  }
  return '操作に失敗しました。';
};

const Panel = ({ children, className }: React.PropsWithChildren<{ className?: string }>) => (
  <section className={cn('rounded-lg border border-amber-800/30 bg-stone-950/75 p-4 shadow-2xl shadow-black/30 backdrop-blur', className)}>
    {children}
  </section>
);

const RoleCard = ({ roleId, label }: { roleId?: keyof typeof ROLE_DEFINITIONS; label?: string }) => (
  <div className="card-flip mx-auto w-full max-w-xs overflow-hidden rounded-lg border border-amber-600/40 bg-[linear-gradient(145deg,#3b2920,#120f0d)] shadow-xl shadow-black/30 sm:max-w-sm">
    {roleId && ROLE_IMAGES[roleId] && (
      <img className="mx-auto aspect-square w-full max-h-72 object-contain bg-stone-950/40 sm:max-h-80" src={ROLE_IMAGES[roleId]} alt={`${ROLE_DEFINITIONS[roleId].name}のカード`} />
    )}
    <div className="p-4">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">{label ?? 'あなたの役職'}</p>
      <p className="mt-3 text-3xl font-black text-amber-50">{roleId ? ROLE_DEFINITIONS[roleId].name : '???'}</p>
      {roleId && <p className="mt-2 text-sm text-amber-100/75">{ROLE_DEFINITIONS[roleId].description}</p>}
    </div>
  </div>
);

const TopScreen = ({ uid, onEnter }: { uid: string; onEnter: (code: string) => void }) => {
  const [name, setName] = useState(localStorage.getItem('playerName') ?? playerNameFallback());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [statsOpen, setStatsOpen] = useState(false);
  const stats = loadStats(uid);

  const rememberName = () => localStorage.setItem('playerName', name.trim() || playerNameFallback());

  const handleCreate = async () => {
    setBusy(true);
    setError('');
    try {
      rememberName();
      const roomCode = await createRoom(uid, name.trim() || playerNameFallback());
      onEnter(roomCode);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setError('');
    try {
      rememberName();
      await joinRoom(code.trim().toUpperCase(), uid, name.trim() || playerNameFallback());
      onEnter(code.trim().toUpperCase());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl items-center px-4 py-8">
      <div className="grid w-full gap-6 md:grid-cols-[1.1fr_0.9fr] md:items-center">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.3em] text-red-300">Discord Call Board Game</p>
          <h1 className="mt-3 text-4xl font-black text-amber-50 sm:text-6xl">ワンナイト人狼</h1>
          <p className="mt-4 max-w-xl text-base leading-8 text-amber-100/80">
            通話は Discord、カードと進行はこの卓で。匿名ログインだけでルームを作ってすぐ遊べます。
          </p>
        </div>
        <Panel className="space-y-4">
          <label className="block text-sm font-bold text-amber-100">
            プレイヤー名
            <input
              className="mt-2 w-full rounded-lg border border-amber-800/40 bg-stone-950 px-3 py-3 text-amber-50 outline-none focus:border-red-600"
              value={name}
              maxLength={16}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <Button className="w-full" disabled={busy} onClick={handleCreate}>
            <Play size={18} /> ルーム作成
          </Button>
          <Button className="w-full" variant="secondary" onClick={() => setStatsOpen(true)}>
            <BarChart3 size={18} /> スタッツ
          </Button>
          {error && <p className="rounded-lg border border-red-700/40 bg-red-950/60 p-3 text-sm font-bold text-red-100">{error}</p>}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <input
              className="rounded-lg border border-amber-800/40 bg-stone-950 px-3 py-3 text-center text-lg font-black uppercase tracking-[0.25em] text-amber-50 outline-none focus:border-red-600"
              placeholder="ABCD12"
              value={code}
              maxLength={6}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
            <Button variant="secondary" disabled={busy || code.length < 4} onClick={handleJoin}>
              参加
            </Button>
          </div>
          {statsOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
              <Panel className="w-full max-w-md space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-black text-amber-50">スタッツ</h2>
                  <Button variant="ghost" onClick={() => setStatsOpen(false)}>閉じる</Button>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="grid grid-cols-[1fr_auto_auto] gap-3 rounded-lg bg-stone-900 p-3 text-amber-50">
                    <span className="font-bold">トータル</span>
                    <span>{stats.total.games}戦</span>
                    <span>{rateText(stats.total)}</span>
                  </div>
                  {roleList.map((role) => (
                    <div key={role.id} className="grid grid-cols-[1fr_auto_auto] gap-3 rounded-lg bg-stone-900 p-3 text-amber-100">
                      <span className="font-bold">{role.name}</span>
                      <span>{stats.roles[role.id].games}戦</span>
                      <span>{rateText(stats.roles[role.id])}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          )}
        </Panel>
      </div>
    </main>
  );
};

const LobbyScreen = ({ room, uid, players }: { room: Room; uid: string; players: Player[] }) => {
  const isHost = room.hostUid === uid;
  const currentPlayer = room.players[uid];
  const allReady = players.length >= 3 && players.every((player) => player.isReady);
  const [counts, setCounts] = useState<RoleCounts>(room.settings.roleCounts);
  const [duration, setDuration] = useState<DiscussionDuration>(room.settings.discussionDuration);
  const [soloWerewolfCanPeekCenter, setSoloWerewolfCanPeekCenter] = useState(room.settings.soloWerewolfCanPeekCenter !== false);
  const [martyrMode, setMartyrMode] = useState(room.settings.martyrMode === true);
  const [error, setError] = useState('');

  useEffect(() => {
    setCounts(room.settings.roleCounts);
    setDuration(room.settings.discussionDuration);
    setSoloWerewolfCanPeekCenter(room.settings.soloWerewolfCanPeekCenter !== false);
    setMartyrMode(room.settings.martyrMode === true);
  }, [room.settings]);

  const requiredDeckSize = players.length + 2;
  const autoCounts = withAutoVillagers(counts, requiredDeckSize);
  const deckSize = Object.values(autoCounts).reduce((sum, value) => sum + value, 0);
  const fixedRoleTotal = roleCountOptions.reduce((sum, option) => sum + (counts[option.roleId] ?? 0), 0);
  const roleSelectionIsValid = fixedRoleTotal <= requiredDeckSize;

  const runLobbyAction = async (action: () => Promise<void>) => {
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const saveSettings = () => runLobbyAction(() => updateSettings(room.code, duration, autoCounts, players.length, soloWerewolfCanPeekCenter, martyrMode));

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-6 lg:grid-cols-[1fr_360px]">
      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-amber-200/70">ルームコード</p>
            <p className="text-4xl font-black tracking-[0.25em] text-amber-50">{room.code}</p>
          </div>
          <Button variant="secondary" onClick={() => navigator.clipboard.writeText(room.code)}>
            <Clipboard size={18} /> コピー
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {players.map((player) => (
            <div key={player.uid} className="flex items-center justify-between rounded-lg border border-amber-800/30 bg-stone-900/70 p-3">
              <span className="font-bold text-amber-50">
                {player.isHost && <Crown className="mr-2 inline text-amber-400" size={16} />}
                {player.isCpu && <Bot className="mr-2 inline text-red-300" size={16} />}
                {player.name}
              </span>
              <div className="flex items-center gap-2">
                <span className={cn('rounded-full px-3 py-1 text-xs font-bold', player.isReady ? 'bg-emerald-700 text-white' : 'bg-stone-700 text-stone-200')}>
                  {player.isReady ? 'Ready' : 'Waiting'}
                </span>
                {isHost && player.isCpu && (
                  <button
                    className="inline-flex size-8 items-center justify-center rounded-lg border border-red-700/40 bg-red-950/50 text-red-100 hover:bg-red-900"
                    title="CPUを削除"
                    onClick={() => runLobbyAction(() => removeCpuPlayer(room, player.uid))}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={currentPlayer?.isReady ? 'secondary' : 'primary'} onClick={() => setReady(room.code, uid, !currentPlayer?.isReady)}>
            <Check size={18} /> {currentPlayer?.isReady ? 'Ready解除' : 'Ready'}
          </Button>
          {isHost && (
            <Button disabled={!allReady || !roleSelectionIsValid || deckSize !== requiredDeckSize} onClick={() => runLobbyAction(() => startGame(room))}>
              <Moon size={18} /> ゲーム開始
            </Button>
          )}
          {isHost && room.phase === 'lobby' && (
            <Button variant="secondary" onClick={() => runLobbyAction(() => addCpuPlayer(room))}>
              <Bot size={18} /> CPU追加
            </Button>
          )}
        </div>
        {error && <p className="rounded-lg border border-red-700/40 bg-red-950/60 p-3 text-sm font-bold text-red-100">{error}</p>}
      </Panel>
      <Panel className="space-y-4">
        <div>
          <h2 className="text-lg font-black text-amber-50">卓設定</h2>
          <p className={cn('mt-1 text-sm font-bold', deckSize === requiredDeckSize ? 'text-emerald-300' : 'text-red-300')}>
            カード {deckSize} / 必要 {requiredDeckSize}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {durationOptions.map((option) => (
            <button
              key={option.value}
              className={cn('rounded-lg border px-3 py-2 text-sm font-bold', duration === option.value ? 'border-red-500 bg-red-950 text-amber-50' : 'border-amber-800/30 bg-stone-900 text-amber-100')}
              disabled={!isHost}
              onClick={() => setDuration(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="flex items-start gap-3 rounded-lg border border-amber-800/30 bg-stone-900/70 p-3 text-sm font-bold text-amber-100">
          <input
            className="mt-1"
            type="checkbox"
            checked={soloWerewolfCanPeekCenter}
            disabled={!isHost}
            onChange={(event) => setSoloWerewolfCanPeekCenter(event.target.checked)}
          />
          <span>
            人狼が1人だけの時、中央カードを1枚見られる
            <span className="mt-1 block text-xs font-normal text-amber-100/65">オフにすると、単独人狼は仲間確認のみで中央カードを見ません。</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-amber-800/30 bg-stone-900/70 p-3 text-sm font-bold text-amber-100">
          <input
            className="mt-1"
            type="checkbox"
            checked={martyrMode}
            disabled={!isHost}
            onChange={(event) => setMartyrMode(event.target.checked)}
          />
          <span>
            殉教者モード
            <span className="mt-1 block text-xs font-normal text-amber-100/65">オンの時、平和村では処刑されたプレイヤーが勝利します。</span>
          </span>
        </label>
        <div className="space-y-3">
          {roleCountOptions.map((option) => (
            <div key={option.roleId} className="grid gap-2 rounded-lg border border-amber-800/30 bg-stone-900/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold text-amber-100">{option.label}</span>
                <span className="text-xs font-bold text-amber-200/70">{counts[option.roleId]}人</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {option.options.map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={!isHost}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-sm font-black transition',
                      counts[option.roleId] === value
                        ? 'border-red-500 bg-red-950 text-amber-50 shadow-[0_0_18px_rgba(127,29,29,0.45)]'
                        : 'border-amber-800/30 bg-stone-950 text-amber-100 hover:bg-stone-800',
                      !isHost && 'opacity-70',
                    )}
                    onClick={() => setCounts(withAutoVillagers({ ...counts, [option.roleId]: value }, requiredDeckSize))}
                  >
                    {value}人
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between rounded-lg border border-amber-800/30 bg-stone-950/80 p-3">
            <span className="text-sm font-bold text-amber-100">村人</span>
            <span className="text-lg font-black text-amber-50">{autoCounts.villager}人</span>
          </div>
          {!roleSelectionIsValid && (
            <p className="rounded-lg border border-red-700/40 bg-red-950/60 p-3 text-sm font-bold text-red-100">
              選択した役職カードが必要枚数を超えています。人数を減らしてください。
            </p>
          )}
        </div>
        {isHost && (
          <Button className="w-full" variant="secondary" disabled={!roleSelectionIsValid} onClick={saveSettings}>
            設定を反映
          </Button>
        )}
      </Panel>
    </div>
  );
};

const NightScreen = ({ room, uid, players, privateState }: GameProps) => {
  const [targetUid, setTargetUid] = useState('');
  const [seerCenter, setSeerCenter] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsed = Math.floor((now - (room.startedAt ?? now)) / 1000);
  const remaining = Math.max(0, 120 - elapsed);
  const remainingLabel = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;

  if (!privateState) return <PhaseShell title="夜" icon={<Moon />}>カードを配っています。</PhaseShell>;

  const role = ROLE_DEFINITIONS[privateState.initialRole];
  const skipped = room.nightDone?.[uid];
  const actionDone = Boolean(privateState.nightAction);
  const selectablePlayers = players.filter((player) => player.uid !== uid);
  const submit = (action: NightAction) => submitNightAction(room.code, uid, action, privateState, room.players);

  const SkipControl = () => (
    <div className="space-y-3 rounded-lg border border-amber-800/30 bg-stone-900/70 p-3">
      <p className="flex items-center gap-2 text-sm font-bold text-amber-100">
        <Timer size={16} /> 夜の残り時間 {remainingLabel}
      </p>
      <p className="text-sm text-amber-100/70">
        夜は2分です。全員がスキップを押した時だけ昼へ進みます。
      </p>
      <Button className="w-full" variant={skipped ? 'secondary' : 'primary'} disabled={skipped} onClick={() => skipNightAction(room.code, uid)}>
        <Check size={18} /> {skipped ? 'スキップ済み' : '夜をスキップ'}
      </Button>
    </div>
  );

  if (!role.hasNightAction || actionDone) {
    return (
      <PhaseShell title="夜" icon={<Moon />}>
        <RoleCard roleId={privateState.initialRole} />
        {privateState.seen?.length ? <SeenList state={privateState} /> : <p className="text-amber-100/80">夜が明けるまでお待ちください。</p>}
        <SkipControl />
      </PhaseShell>
    );
  }

  if (privateState.initialRole === 'werewolf') {
    const partners = privateState.werewolfPartners ?? [];
    const canPeekCenter = Boolean(privateState.soloWerewolfPeek);
    return (
      <PhaseShell title="夜" icon={<Moon />}>
        <RoleCard roleId="werewolf" />
        {partners.length ? (
          <p className="text-amber-100">仲間: {partners.map((id) => room.players[id]?.name).join('、')}</p>
        ) : canPeekCenter ? (
          <p className="text-amber-100">1人の人狼です。中央カードを1枚確認できます。</p>
        ) : (
          <p className="text-amber-100">1人の人狼です。この卓設定では中央カードを確認できません。</p>
        )}
        {canPeekCenter && <Button onClick={() => submit({ actorUid: uid, kind: 'werewolf-peek', createdAt: Date.now() })}>中央カードを確認</Button>}
        <SkipControl />
      </PhaseShell>
    );
  }

  if (privateState.initialRole === 'seer') {
    return (
      <PhaseShell title="夜" icon={<Moon />}>
        <RoleCard roleId="seer" />
        <label className="flex items-center gap-2 text-sm font-bold text-amber-100">
          <input type="checkbox" checked={seerCenter} onChange={(event) => setSeerCenter(event.target.checked)} />
          中央カード2枚を見る
        </label>
        {!seerCenter && <PlayerSelect players={selectablePlayers} value={targetUid} onChange={setTargetUid} />}
        <Button disabled={!seerCenter && !targetUid} onClick={() => submit({ actorUid: uid, kind: seerCenter ? 'seer-center' : 'seer-player', targetUid: seerCenter ? undefined : targetUid, createdAt: Date.now() })}>
          <Send size={18} /> 占う
        </Button>
        <SkipControl />
      </PhaseShell>
    );
  }

  if (privateState.initialRole === 'robber') {
    return (
      <PhaseShell title="夜" icon={<Moon />}>
        <RoleCard roleId="robber" />
        <PlayerSelect players={selectablePlayers} value={targetUid} onChange={setTargetUid} />
        <Button disabled={!targetUid} onClick={() => submit({ actorUid: uid, kind: 'robber', targetUid, createdAt: Date.now() })}>
          <Send size={18} /> 交換
        </Button>
        <SkipControl />
      </PhaseShell>
    );
  }

  return (
    <PhaseShell title="夜" icon={<Moon />}>
      <RoleCard roleId={privateState.initialRole} />
      <SkipControl />
    </PhaseShell>
  );
};

type GameProps = { room: Room; uid: string; players: Player[]; privateState?: PrivatePlayerState };

const PhaseShell = ({ title, icon, children }: React.PropsWithChildren<{ title: string; icon: React.ReactNode }>) => (
  <main className="mx-auto flex min-h-dvh w-full max-w-4xl items-center px-4 py-6">
    <Panel className="w-full space-y-5">
      <h2 className="flex items-center gap-2 text-2xl font-black text-amber-50">{icon}{title}</h2>
      {children}
    </Panel>
  </main>
);

const PlayerSelect = ({ players, value, onChange }: { players: Player[]; value: string; onChange: (uid: string) => void }) => (
  <div className="grid gap-2 sm:grid-cols-2">
    {players.map((player) => (
      <button
        key={player.uid}
        className={cn('rounded-lg border px-4 py-3 text-left font-bold', value === player.uid ? 'border-red-500 bg-red-950 text-amber-50' : 'border-amber-800/30 bg-stone-900 text-amber-100')}
        onClick={() => onChange(player.uid)}
      >
        {player.name}
      </button>
    ))}
  </div>
);

const SeenList = ({ state }: { state: NonNullable<GameProps['privateState']> }) => (
  <div className="grid gap-3">
    {state.seen?.map((item) => (
      <div key={`${item.label}-${item.roleId}`} className="grid gap-3 rounded-lg border border-amber-800/30 bg-stone-900 p-3 text-amber-50 sm:grid-cols-[80px_1fr] sm:items-center">
        {ROLE_IMAGES[item.roleId] && (
          <img
            className="aspect-square w-20 rounded-lg border border-amber-700/40 object-cover"
            src={ROLE_IMAGES[item.roleId]}
            alt={`${roleName(item.roleId)}のカード`}
          />
        )}
        <div>
          <p className="text-sm font-bold text-amber-200">{item.label}</p>
          <p className="text-2xl font-black text-amber-50">{roleName(item.roleId)}</p>
          {state.initialRole === 'robber' && <p className="mt-1 text-sm text-amber-100/75">交換後のあなたの役職です。</p>}
        </div>
      </div>
    ))}
  </div>
);

const DiscussionRoleDeck = ({ room, privateState }: { room: Room; privateState?: PrivatePlayerState }) => {
  const deck = rolesFromCounts(room.settings.roleCounts);
  const knownRole = privateState?.initialRole === 'robber' && privateState.seen?.[0]?.roleId ? privateState.seen[0].roleId : privateState?.initialRole;
  let ownCardMarked = false;

  return (
    <div className="rounded-lg border border-amber-800/30 bg-stone-900/70 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-black text-amber-50">この卓にある役職カード</p>
        <p className="text-xs font-bold text-amber-200/70">{deck.length}枚</p>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {deck.map((roleId, index) => {
          const isOwn = Boolean(knownRole && roleId === knownRole && !ownCardMarked);
          if (isOwn) ownCardMarked = true;
          return (
            <div
              key={`${roleId}-${index}`}
              className={cn(
                'relative w-20 shrink-0 rounded-lg border bg-stone-950 p-1 text-center shadow-lg shadow-black/20',
                isOwn ? 'border-red-500 ring-2 ring-red-500/50' : 'border-amber-800/30',
              )}
            >
              {isOwn && <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-red-800 px-2 py-0.5 text-[10px] font-black text-amber-50">あなた</span>}
              {ROLE_IMAGES[roleId] ? (
                <img className="aspect-square w-full rounded-md object-cover" src={ROLE_IMAGES[roleId]} alt={`${roleName(roleId)}のカード`} />
              ) : (
                <div className="flex aspect-square items-center justify-center rounded-md bg-stone-800 text-lg font-black text-amber-100">{ROLE_DEFINITIONS[roleId].shortName}</div>
              )}
              <p className="mt-1 truncate text-xs font-bold text-amber-100">{roleName(roleId)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ResultRoleTransition = ({ reveal, executed }: { reveal: NonNullable<Room['result']>['reveals'][number]; executed: boolean }) => {
  const changed = reveal.initialRole !== reveal.finalRole;
  if (!changed) {
    return (
      <>
        {ROLE_IMAGES[reveal.finalRole] && (
          <div className="relative mx-auto my-3 w-28 sm:w-32">
            <img
              className={cn('aspect-square w-full rounded-lg border border-amber-700/40 object-cover', executed && 'grayscale')}
              src={ROLE_IMAGES[reveal.finalRole]}
              alt={`${roleName(reveal.finalRole)}のカード`}
            />
            {executed && <div className="absolute inset-0 flex items-center justify-center text-7xl font-black text-red-600 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">×</div>}
          </div>
        )}
        <p className="text-sm text-amber-100">最終: {roleName(reveal.finalRole)} / 初期: {roleName(reveal.initialRole)}</p>
      </>
    );
  }

  return (
    <div className="my-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="text-center">
          {ROLE_IMAGES[reveal.initialRole] && (
            <img className="mx-auto aspect-square w-20 rounded-lg border border-amber-800/40 object-cover opacity-70 grayscale" src={ROLE_IMAGES[reveal.initialRole]} alt={`${roleName(reveal.initialRole)}のカード`} />
          )}
          <p className="mt-1 text-xs font-bold text-amber-200/70">元: {roleName(reveal.initialRole)}</p>
        </div>
        <span className="text-2xl font-black text-red-300">→</span>
        <div className="text-center">
          <div className="relative mx-auto w-20">
            {ROLE_IMAGES[reveal.finalRole] && (
              <img
                className={cn('aspect-square w-full rounded-lg border border-amber-700/40 object-cover', executed && 'grayscale')}
                src={ROLE_IMAGES[reveal.finalRole]}
                alt={`${roleName(reveal.finalRole)}のカード`}
              />
            )}
            {executed && <div className="absolute inset-0 flex items-center justify-center text-5xl font-black text-red-600 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">×</div>}
          </div>
          <p className="mt-1 text-xs font-bold text-amber-100">後: {roleName(reveal.finalRole)}</p>
        </div>
      </div>
      <p className="mt-2 rounded bg-red-950/40 px-2 py-1 text-center text-xs font-bold text-red-100">怪盗の交換で役職が変化</p>
    </div>
  );
};

const DiscussionScreen = ({ room, uid, players, privateState }: GameProps) => {
  const isHost = room.hostUid === uid;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const duration = room.settings.discussionDuration;
  const elapsed = Math.floor((now - (room.discussionStartedAt ?? now)) / 1000);
  const remaining = duration === 0 ? 0 : Math.max(0, duration - elapsed);
  const label = duration === 0 ? '無制限' : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;

  useEffect(() => {
    if (isHost && duration !== 0 && remaining === 0) startVote(room.code);
  }, [duration, isHost, remaining, room.code]);

  return (
    <PhaseShell title="議論" icon={<Users />}>
      <p className="text-xl font-black text-amber-50">議論してください</p>
      {privateState && (
        <div className="grid gap-3 rounded-lg border border-amber-800/30 bg-stone-900/70 p-3 sm:grid-cols-[80px_1fr] sm:items-center">
          {ROLE_IMAGES[privateState.initialRole] && (
            <img
              className="aspect-square w-20 rounded-lg border border-amber-700/40 object-cover"
              src={ROLE_IMAGES[privateState.initialRole]}
              alt={`${ROLE_DEFINITIONS[privateState.initialRole].name}のカード`}
            />
          )}
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">あなたの役職</p>
            <p className="text-2xl font-black text-amber-50">{ROLE_DEFINITIONS[privateState.initialRole].name}</p>
          </div>
        </div>
      )}
      <DiscussionRoleDeck room={room} privateState={privateState} />
      <div className="rounded-lg bg-stone-950 p-6 text-center text-6xl font-black text-red-200">{label}</div>
      <div className="flex flex-wrap gap-2 text-sm text-amber-100/80">{players.map((player) => <span key={player.uid}>{player.name}</span>)}</div>
      {isHost && <Button onClick={() => startVote(room.code)}><Vote size={18} /> 投票へ</Button>}
    </PhaseShell>
  );
};

const VoteScreen = ({ room, uid, players }: GameProps) => {
  const [targetUid, setTargetUid] = useState('');
  const voted = Boolean(room.votes?.[uid]);
  const allVoted = players.every((player) => room.votes?.[player.uid]);
  useEffect(() => {
    if (allVoted && room.phase === 'vote') revealResults(room);
  }, [allVoted, room]);

  return (
    <PhaseShell title="投票" icon={<Vote />}>
      {voted ? (
        <p className="text-amber-100">全員の投票が終わるまで公開されません。</p>
      ) : (
        <>
          <PlayerSelect players={players.filter((player) => player.uid !== uid)} value={targetUid} onChange={setTargetUid} />
          <button
            className={cn('rounded-lg border px-4 py-3 text-left font-bold', targetUid === NO_VOTE_TARGET ? 'border-red-500 bg-red-950 text-amber-50' : 'border-amber-800/30 bg-stone-900 text-amber-100')}
            onClick={() => setTargetUid(NO_VOTE_TARGET)}
          >
            誰にも投票しない
          </button>
        </>
      )}
      <Button disabled={voted || !targetUid} onClick={() => submitVote(room.code, uid, targetUid)}>
        <Send size={18} /> 投票
      </Button>
      <p className="text-sm text-amber-200/70">投票済み {Object.keys(room.votes ?? {}).length} / {players.length}</p>
    </PhaseShell>
  );
};

const ResultScreen = ({ room, uid }: GameProps) => {
  const result = room.result;
  if (!result) return <PhaseShell title="結果" icon={<Vote />}>集計しています。</PhaseShell>;
  const nameOf = (id: string) => room.players[id]?.name ?? '不明';
  const executedNames = result.executedUids.map(nameOf);
  const winningNames = (result.winningUids ?? []).map(nameOf);
  const resultImage = resultImageFor(result);
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-6 lg:grid-cols-[1fr_360px]">
      <Panel className="space-y-4">
        {resultImage && (
          <img
            className="mx-auto aspect-[4/5] w-full max-w-xs rounded-lg border border-amber-700/40 object-cover shadow-xl shadow-black/30 sm:max-w-sm"
            src={resultImage}
            alt="勝利結果"
          />
        )}
        <h2 className="text-3xl font-black text-amber-50">結果</h2>
        <div className="execution-reveal rounded-lg border border-red-700/50 bg-red-950/70 p-4 text-center shadow-lg shadow-red-950/30">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-red-200">処刑</p>
          <p className="mt-2 text-2xl font-black text-amber-50">
            {executedNames.length ? executedNames.join('、') : '処刑なし'}
          </p>
        </div>
        <p className="rounded-lg bg-red-950/70 p-4 text-lg font-bold text-amber-50">{result.reason}</p>
        {winningNames.length > 0 && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-900/30 p-3 text-lg font-black text-amber-50">
            勝者: {winningNames.join('、')}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {result.reveals.map((reveal) => {
            const executed = result.executedUids.includes(reveal.uid);
            return (
            <div key={reveal.uid} className={cn('rounded-lg border bg-stone-900 p-3', executed ? 'execution-card border-red-700/70' : 'border-amber-800/30')}>
              <p className="font-black text-amber-50">{nameOf(reveal.uid)}</p>
              <ResultRoleTransition reveal={reveal} executed={executed} />
              <p className="text-xs text-amber-200/70">{visibleTeamName(reveal.finalRole)}</p>
            </div>
            );
          })}
        </div>
      </Panel>
      <Panel className="space-y-4">
        <h3 className="text-xl font-black text-amber-50">投票</h3>
        {Object.entries(room.votes ?? {}).map(([from, to]) => (
          <p key={from} className="text-amber-100">{nameOf(from)} → {to === NO_VOTE_TARGET ? '誰にも投票しない' : nameOf(to)}</p>
        ))}
        <h3 className="pt-2 text-xl font-black text-amber-50">交換ログ</h3>
        {result.exchangeLogs.length ? result.exchangeLogs.map((log) => (
          <p key={log.order} className="text-amber-100">{roleName(log.roleId)} → {nameOf(log.actorUid)} ⇔ {nameOf(log.targetUid)}</p>
        )) : <p className="text-amber-100/70">交換はありません。</p>}
        {room.hostUid === uid && (
          <div className="grid gap-2">
            <Button onClick={() => startNextGame(room)}><Play size={18} /> 次のゲーム</Button>
            <Button variant="secondary" onClick={() => resetRoom(room)}><RotateCcw size={18} /> 待機室へ</Button>
          </div>
        )}
      </Panel>
    </main>
  );
};

const GameRouter = ({ room, uid, players, privateState }: GameProps) => {
  const nightComplete = players.length > 0 && players.every((player) => room.nightDone?.[player.uid]);
  const [now, setNow] = useState(Date.now());
  const nightTimedOut = room.phase === 'night' && Boolean(room.startedAt) && now - (room.startedAt ?? now) >= 120_000;

  useEffect(() => {
    if (room.phase !== 'night') return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [room.phase]);

  useEffect(() => {
    if (room.phase === 'night' && room.hostUid === uid && (nightComplete || nightTimedOut)) finishNight(room.code);
  }, [nightComplete, nightTimedOut, room, uid]);

  useEffect(() => {
    if (room.phase === 'vote' && room.hostUid === uid) submitCpuVotes(room);
  }, [room, uid]);

  if (room.phase === 'lobby') return <LobbyScreen room={room} uid={uid} players={players} />;
  if (room.phase === 'night') return <NightScreen room={room} uid={uid} players={players} privateState={privateState} />;
  if (room.phase === 'discussion') return <DiscussionScreen room={room} uid={uid} players={players} privateState={privateState} />;
  if (room.phase === 'vote') return <VoteScreen room={room} uid={uid} players={players} privateState={privateState} />;
  return <ResultScreen room={room} uid={uid} players={players} privateState={privateState} />;
};

export default function App() {
  const { user, loading } = useAuth();
  const [code, setCode] = useState(new URLSearchParams(location.search).get('room') ?? '');
  const { room, privateState, players } = useRoom(code, user?.uid);
  const uid = user?.uid;

  useEffect(() => {
    if (uid && room?.phase === 'result') recordResultStats(uid, room);
  }, [room, uid]);

  if (!supabaseConfigured) {
    return (
      <PhaseShell title="Supabase設定" icon={<Moon />}>
        <p className="text-amber-100">`.env.local` に Supabase の URL と anon key を入れると、匿名ログインとルーム同期が有効になります。</p>
        <div className="rounded-lg bg-stone-950 p-4 font-mono text-sm text-amber-200">
          VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
        </div>
      </PhaseShell>
    );
  }

  if (loading || !uid) {
    return <PhaseShell title="準備中" icon={<Moon />}>匿名ログインを準備しています。</PhaseShell>;
  }

  if (!room) return <TopScreen uid={uid} onEnter={(roomCode) => {
    history.replaceState(null, '', `?room=${roomCode}`);
    setCode(roomCode);
  }} />;

  return (
    <>
      <button
        className="fixed right-4 top-4 z-40 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-amber-700/40 bg-stone-950/90 px-3 py-2 text-sm font-bold text-amber-100 shadow-lg shadow-black/30 hover:bg-stone-900"
        onClick={async () => {
          await leaveRoom(room, uid);
          history.replaceState(null, '', location.pathname);
          setCode('');
        }}
      >
        <LogOut size={16} /> 退出
      </button>
      <GameRouter room={room} uid={uid} players={players} privateState={privateState} />
    </>
  );
}
