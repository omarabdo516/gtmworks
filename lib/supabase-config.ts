import { supabaseSettings } from './supabase-settings.mjs';
// Read at runtime so one image can be configured for each deployment.
const env = process.env;
export const supabaseConfig = supabaseSettings(env);
