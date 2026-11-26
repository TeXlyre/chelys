import { pluginTypeRegistry } from '../../plugin-host/PluginTypeRegistry';
import { withBridgeStart, withBridgeStop } from '../../plugin-host/bridgeHooks';
import { withRouteStart, withRouteStop } from '../../plugin-host/routeHooks';
import { getInstanceId } from '../../control/protocol';
import { accountStores } from '../../control/stores';
import { getActiveAccountId } from '../../plugin-host/activeAccount';
import { ENDPOINT_PREFIX, instanceRecipeId } from '../service/shared';
import { ENDPOINT_TYPE, endpointDescriptor, readEndpointTransport } from './shared';
import type { Recipe } from '../../plugin-host/types';

const read = (recipe: Recipe) => readEndpointTransport(recipe, getInstanceId());
const publish = (recipe: Recipe) => {
    const descriptor = endpointDescriptor(recipe, getInstanceId());
    if (getActiveAccountId()) accountStores.set('settings', ENDPOINT_PREFIX + descriptor.id, descriptor);
};
const withdraw = (recipe: Recipe) => {
    if (!getActiveAccountId()) return;
    const key = ENDPOINT_PREFIX + instanceRecipeId(getInstanceId(), recipe.id);
    if (accountStores.list('settings').includes(key)) accountStores.delete('settings', key);
};
export function registerEndpointPlugin(): void {
    pluginTypeRegistry.register({
        type: ENDPOINT_TYPE, label: 'Endpoint', seeds: [],
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/></svg>',
        formSchema: [
            { key: 'protocol', label: 'Protocol', kind: 'text', placeholder: 'example/1' },
            { key: 'transportType', label: 'Transport', kind: 'text', placeholder: 'websocket or webrtc' },
            { key: 'transportUrl', label: 'WebSocket URL', kind: 'text', placeholder: 'ws://127.0.0.1:9070/ws' },
            { key: 'transportRoomId', label: 'Room override', kind: 'text', help: 'Optional. Defaults to the account and machine-specific endpoint ID.' },
            { key: 'signalingServers', label: 'Signaling servers', kind: 'list' },
        ],
        toConfigBlock: recipe => endpointDescriptor(recipe, getInstanceId()),
        onStart: withRouteStart(withBridgeStart(read)(publish)),
        onStop: withRouteStop(withBridgeStop(read)(withdraw)),
    });
}
