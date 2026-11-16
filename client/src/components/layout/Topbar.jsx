import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Menu, Bell, LogOut, Search, LayoutDashboard, KeyRound, ChevronDown, Sun, Moon, Camera } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useTheme } from '../../hooks/useTheme.jsx';
import { HOME_FOR_ROLE, ROLE_LABEL } from '../../routes/nav.js';
import { api, unwrap, setTokens } from '../../lib/api.js';
import { getSocket } from '../../lib/socket.js';
import { relative } from '../../lib/format.js';
import { Modal } from '../ui/Modal.jsx';
import { Field, fieldErrors } from '../ui/Page.jsx';
import { Spinner } from '../ui/States.jsx';
import { Avatar } from '../ui/Avatar.jsx';
import { ProfilePhotoModal } from './ProfilePhoto.jsx';

const PATIENT_SEARCH_PATH = {
  CLINIC_OWNER: '/clinic/patients', BRANCH_MANAGER: '/clinic/branch/patients', DOCTOR: '/clinic/doctor/patients',
  RECEPTIONIST: '/clinic/reception/register', ACCOUNTANT: '/clinic/accounts/invoices',
};

function Notifications() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get('/clinics/notifications').then(unwrap), refetchInterval: 60_000 });
  useEffect(() => {
    const s = getSocket();
    if (!s) return undefined;
    const on = () => qc.invalidateQueries({ queryKey: ['notifications'] });
    s.on('notification', on);
    return () => s.off('notification', on);
  }, [qc]);
  const markRead = useMutation({ mutationFn: () => api.post('/clinics/notifications/read'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const unread = data?.unread || 0;
  return (
    <div className="relative">
      <button onClick={() => { setOpen((o) => !o); if (!open && unread) markRead.mutate(); }}
              aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}
              className="relative rounded-lg p-2 text-ink-muted hover:bg-paper-sunk">
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
        {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-alert px-1 text-[10px] font-semibold text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-80 rounded-card border border-line bg-surface p-2 shadow-lift">
          <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Notifications</p>
          {!data?.items?.length && <p className="px-2 py-6 text-center text-sm text-ink-muted">You're all caught up.</p>}
          <ul className="max-h-80 overflow-y-auto">
            {data?.items?.map((n) => (
              <li key={n._id}>
                <Link to={n.link || '#'} onClick={() => setOpen(false)} className="block rounded-lg px-2 py-2 hover:bg-paper-sunk">
                  <p className="text-sm">{n.title}</p>
                  <p className="text-xs text-ink-muted">{relative(n.createdAt)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ChangePassword({ open, onClose }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [errors, setErrors] = useState({});
  const save = useMutation({
    mutationFn: () => api.post('/auth/change-password', form).then(unwrap),
    onSuccess: (d) => { setTokens({ access: d.accessToken, refresh: d.refreshToken }); toast.success('Password changed'); setForm({ currentPassword: '', newPassword: '' }); onClose(); },
    onError: (e) => { setErrors(fieldErrors(e)); toast.error(e.message); },
  });
  return (
    <Modal open={open} onClose={onClose} title="Change password" footer={(
      <><button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={save.isPending || !form.currentPassword || form.newPassword.length < 8} onClick={() => save.mutate()}>{save.isPending && <Spinner />} Update</button></>
    )}>
      <div className="space-y-4">
        <Field label="Current password" htmlFor="cp-cur"><input id="cp-cur" type="password" autoComplete="current-password" className="field" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} /></Field>
        <Field label="New password" htmlFor="cp-new" hint="At least 8 characters with a letter and a number." error={errors.newPassword}>
          <input id="cp-new" type="password" autoComplete="new-password" className="field" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

export function Topbar({ onMenu }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [q, setQ] = useState('');
  const menuRef = useRef(null);
  const isStaff = user && !['SUPER_ADMIN', 'PATIENT'].includes(user.role);
  const searchPath = PATIENT_SEARCH_PATH[user?.role];

  useEffect(() => {
    if (!showMenu) return undefined;
    const close = (e) => !menuRef.current?.contains(e.target) && setShowMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [showMenu]);

  const doLogout = async () => navigate(await logout(), { replace: true });

  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center gap-3 border-b border-line/70 bg-surface/75 px-4 backdrop-blur-xl sm:px-6">
      <button onClick={onMenu} aria-label="Open menu" className="rounded-lg p-1.5 hover:bg-paper-sunk lg:hidden">
        <Menu className="h-5 w-5" />
      </button>

      {searchPath && (
        <form role="search" className="relative hidden max-w-md flex-1 sm:block"
              onSubmit={(e) => { e.preventDefault(); navigate(`${searchPath}?q=${encodeURIComponent(q)}`); }}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input className="field bg-paper py-2 pl-9 text-sm" placeholder="Search patients by name or phone…" aria-label="Search patients"
                 value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
      )}
      {/* Always present so the bell, theme and profile menu pin right in every role,
          including the ones whose search form is capped by max-w-md. */}
      <div className="flex-1" />

      {isStaff && <Notifications />}

      <button
        onClick={toggleTheme}
        aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        className="rounded-lg p-2 text-ink-muted hover:bg-paper-sunk"
      >
        {theme === 'light' ? (
          <Moon className="h-[18px] w-[18px]" strokeWidth={1.75} />
        ) : (
          <Sun className="h-[18px] w-[18px]" strokeWidth={1.75} />
        )}
      </button>

      <div className="relative" ref={menuRef}>
        <button onClick={() => setShowMenu((s) => !s)} aria-label="Open profile menu" aria-expanded={showMenu}
                className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-paper-sunk">
          <Avatar name={user?.name} src={user?.avatarUrl} className="h-9 w-9 text-sm ring-2 ring-surface shadow" />
          <span className="hidden text-left sm:block">
            <span className="block max-w-[10rem] truncate text-sm font-medium text-ink">{user?.name}</span>
            <span className="block text-xs text-ink-muted">{ROLE_LABEL[user?.role]}</span>
          </span>
          <ChevronDown className="hidden h-3.5 w-3.5 text-ink-muted sm:inline" />
        </button>
        {showMenu && (
          <div className="absolute right-0 top-12 z-30 w-56 rounded-card border border-line bg-surface p-1 shadow-lift">
            <div className="flex items-center gap-3 px-3 py-2">
              <Avatar name={user?.name} src={user?.avatarUrl} className="h-10 w-10 text-sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user?.name}</p>
                <p className="truncate text-xs text-ink-muted">{user?.email || user?.phone}</p>
              </div>
            </div>
            <hr className="my-1 border-line" />
            <Link to={HOME_FOR_ROLE[user?.role] || '/'} onClick={() => setShowMenu(false)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-paper-sunk">
              <LayoutDashboard className="h-4 w-4" /> Dashboard
            </Link>
            {user?.role !== 'SUPER_ADMIN' && (
              <button onClick={() => { setShowMenu(false); setPhotoOpen(true); }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-soft hover:bg-paper-sunk">
                <Camera className="h-4 w-4" /> Profile photo
              </button>
            )}
            {user?.role !== 'PATIENT' && (
              <button onClick={() => { setShowMenu(false); setPwOpen(true); }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-soft hover:bg-paper-sunk">
                <KeyRound className="h-4 w-4" /> Change password
              </button>
            )}
            <hr className="my-1 border-line" />
            <button onClick={doLogout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-soft hover:bg-paper-sunk">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        )}
      </div>
      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
      <ProfilePhotoModal open={photoOpen} onClose={() => setPhotoOpen(false)} />
    </header>
  );
}
