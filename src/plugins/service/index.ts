import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import { SERVICE_TYPE } from './shared';

export function registerServicePlugin(): void {
    pluginTypeRegistry.register({
        type: SERVICE_TYPE, label: 'Services', exclusive: true, seeds: [],
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 8h10M7 12h10M7 16h10"/></svg>',
        formSchema: [{ key: 'members', label: 'Member plugins', kind: 'list', help: 'Local recipe IDs or remote machine UUID/recipe ID. Comma separated. Existing plugins are reused.' }],
    });
}
