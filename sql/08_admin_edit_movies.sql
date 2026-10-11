-- Allow admins to edit movie catalog details from the Currently Screening list.
-- Regular authenticated users remain unable to update movies through RLS.
drop policy if exists "Admins can update movies" on public.movies;
create policy "Admins can update movies"
  on public.movies for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant update on public.movies to authenticated;
