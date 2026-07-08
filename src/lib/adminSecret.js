// The admin secret lives in one localStorage slot shared by the moderation
// page (/admin) and the admin converter (/admin/create) — unlocking either
// unlocks both. The server does the real gatekeeping; a wrong secret just 401s.

export const SECRET_KEY = 'ascii_admin_secret';

export const getAdminSecret = () => localStorage.getItem(SECRET_KEY) || '';
export const setAdminSecret = (s) => localStorage.setItem(SECRET_KEY, s);
export const clearAdminSecret = () => localStorage.removeItem(SECRET_KEY);
