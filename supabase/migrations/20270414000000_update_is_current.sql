-- #468: when an Owner's request finds nothing newer on the install's channel, the updater records `current` with the
-- version still running, so the Owner is told they already run the newest gtmworks instead of the offer coming back.
alter table public.install_updates drop constraint install_updates_state_check;
alter table public.install_updates add constraint install_updates_state_check
 check(state in ('idle','requested','updating','updated','current','failed'));
