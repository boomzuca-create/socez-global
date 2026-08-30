import { createClient } from "@supabase/supabase-js";

const fallbackUrl = "https://qkiradbwrajrqgnyjhvd.supabase.co";
const fallbackPublishableKey = "sb_publishable_4ai59Nx_9PZMzoF03K5AKw_15H1wbYG";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? fallbackUrl;
export const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? fallbackPublishableKey;

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
