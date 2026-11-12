\getenv password POSTGRES_PASSWORD
alter role authenticator password :'password';
alter role supabase_auth_admin password :'password';
alter role supabase_storage_admin password :'password';
