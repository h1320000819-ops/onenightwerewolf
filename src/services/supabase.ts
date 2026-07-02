import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://example.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'demo-anon-key';

export const supabaseConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export type AppUser = {
  uid: string;
};

export const ensureAnonymousUser = async (): Promise<AppUser> => {
  if (!supabaseConfigured) throw new Error('Supabase configuration is missing.');

  const {
    data: { user: existingUser },
  } = await supabase.auth.getUser();
  if (existingUser) return { uid: existingUser.id };

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error('Anonymous sign-in failed.');
  return { uid: data.user.id };
};
