import { useState } from 'react';
import { t } from '@/i18n';
import { usePluginHost } from '../../hooks/usePluginHost';
import { localCommand } from '../../control/localClient';

type Peer = { id: string; peerKind: string; transport: string; controlAvailable: boolean; username?: string };
type Member = { id: string; name: string; type: string; state?: string };
export default function ServiceMemberPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    const { recipes, registry } = usePluginHost();
    const [peers, setPeers] = useState<Peer[]>([]);
    const [remote, setRemote] = useState<Member[]>([]);
    const [host, setHost] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const local = [...new Map([...registry, ...recipes].filter(item => item.type !== 'service').map(item => [item.id, item])).values()];
    const selected = value.split(/[\s,]+/).filter(Boolean);
    const add = (id: string) => { if (id && !selected.includes(id)) onChange([...selected, id].join(', ')); };
    const load = async (id?: string) => {
        setBusy(true); setError(''); setRemote([]); setHost(id ?? '');
        try {
            if (id) setRemote((await localCommand<Member[]>('peers.call', { target: id, method: 'recipes.list' })).filter(item => item.type !== 'service'));
            else setPeers((await localCommand<Peer[]>('peers.list')).filter(peer => peer.controlAvailable && peer.peerKind === 'chelys' && peer.transport === 'webrtc'));
        } catch (e) { setError(String(e)); } finally { setBusy(false); }
    };
    return <>
        <select aria-label={t('Add local plugin')} value="" onChange={e => add(e.target.value)}><option value="">{t('Add local plugin…')}</option>{local.filter(item => !selected.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <button type="button" className="button" disabled={busy} onClick={() => void load()}>{t('Find remote machines')}</button>
        {peers.length > 0 && <select aria-label={t('Remote machine')} value={host} disabled={busy} onChange={e => void load(e.target.value || undefined)}><option value="">{t('Select remote machine…')}</option>{peers.map(peer => <option key={peer.id} value={peer.id}>{peer.username ? `${peer.username} · ` : ''}{peer.id}</option>)}</select>}
        {host && <select aria-label={t('Add remote plugin')} value="" disabled={busy} onChange={e => add(e.target.value)}><option value="">{t('Add remote plugin…')}</option>{remote.filter(item => !selected.includes(`${host}/${item.id}`)).map(item => <option key={item.id} value={`${host}/${item.id}`}>{item.name} · {item.state}</option>)}</select>}
        {error && <small role="alert">{error}</small>}
    </>;
}
