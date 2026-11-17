import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Camera, Trash2 } from 'lucide-react';
import { api, unwrap } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { Modal } from '../ui/Modal.jsx';
import { Avatar } from '../ui/Avatar.jsx';
import { Spinner } from '../ui/States.jsx';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 2 * 1024 * 1024;

/** Lets the signed-in user add, replace or remove their profile photo. */
export function ProfilePhotoModal({ open, onClose }) {
  const { user, refreshMe } = useAuth();
  const qc = useQueryClient();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);

  // Object URLs hold memory until revoked, so release each one when it's replaced.
  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const reset = () => { setFile(null); setPreview(null); if (inputRef.current) inputRef.current.value = ''; };
  const close = () => { reset(); onClose(); };

  const pick = (e) => {
    const next = e.target.files?.[0];
    if (!next) return;
    if (!TYPES.includes(next.type)) { toast.error('Choose a JPG, PNG or WebP image'); e.target.value = ''; return; }
    if (next.size > MAX_BYTES) { toast.error('Photos must be 2 MB or smaller'); e.target.value = ''; return; }
    setFile(next);
  };

  // Shared follow-up: refresh the session so the top bar shows the change, and the staff list too.
  const done = async (message) => {
    await refreshMe();
    qc.invalidateQueries({ queryKey: ['staff'] });
    toast.success(message);
    close();
  };

  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('photo', file);
      return api.put('/auth/me/avatar', body).then(unwrap);
    },
    onSuccess: () => done('Profile photo updated'),
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => api.delete('/auth/me/avatar').then(unwrap),
    onSuccess: () => done('Profile photo removed'),
    onError: (e) => toast.error(e.message),
  });

  const busy = upload.isPending || remove.isPending;

  return (
    <Modal open={open} onClose={busy ? undefined : close} title="Profile photo" subtitle="JPG, PNG or WebP, up to 2 MB. Shown in the top bar and on the team list."
      icon={Camera} width="max-w-md"
      footer={(
        <div className="flex w-full items-center justify-between gap-3">
          {user?.avatarUrl && !file ? (
            <button className="btn-ghost btn-sm text-alert" disabled={busy} onClick={() => remove.mutate()}>
              {remove.isPending ? <Spinner /> : <Trash2 className="h-3.5 w-3.5" />} Remove photo
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button className="btn-ghost" disabled={busy} onClick={close}>Cancel</button>
            <button className="btn-primary" disabled={!file || busy} onClick={() => upload.mutate()}>
              {upload.isPending && <Spinner />} Save photo
            </button>
          </div>
        </div>
      )}>
      <div className="flex flex-col items-center gap-4">
        <Avatar name={user?.name} src={preview || user?.avatarUrl} className="h-28 w-28 text-3xl ring-4 ring-surface shadow-card" />
        <input ref={inputRef} id="profile-photo" type="file" accept={TYPES.join(',')} className="sr-only" onChange={pick} />
        <label htmlFor="profile-photo" className="btn-ghost cursor-pointer">
          <Camera className="h-4 w-4" /> {file ? 'Choose another photo' : 'Choose photo'}
        </label>
        {file && <p className="max-w-full truncate text-xs text-ink-muted">{file.name}</p>}
      </div>
    </Modal>
  );
}
