// tests/unit/plugins/service.test.ts
import { describe, expect, it } from 'vitest';
import { serviceMembers, validateService, instanceRecipeId } from '@src/plugins/service/shared';
import { endpointDescriptor, readEndpointTransport } from '@src/plugins/endpoint/shared';
import type { Recipe } from '@src/plugin-host/types';
const host = '12345678-1234-1234-1234-123456789abc';
const group: Recipe = {id:'analysis', name:'Analysis',type:'service',env:{},modes:[{kind:'connect'}],typeConfig:{members:['ffmpeg', `${host}/siglip`]}};
const endpoint: Recipe = {...group, id:'ffmpeg', type:'endpoint', typeConfig:{protocol:'media-execution/1',transportType:'webrtc',transportUrl:'ws://127.0.0.1:9070/ws'}};
describe('service composition', () => {
    it('references local and remote instances without process configuration', () => {
        expect(serviceMembers(group)).toEqual([{recipeId:'ffmpeg'}, {instanceId:host,recipeId:'siglip'}]);
        expect(() => validateService(group)).not.toThrow();
        expect(() => validateService({...group,env:{TOKEN:'secret'}})).toThrow();
        expect(instanceRecipeId(host,'ffmpeg')).not.toBe(instanceRecipeId('another-machine','ffmpeg'));
    });
    it('rejects invalid member references', () => {
        for (const members of [[], ['analysis'], ['ffmpeg','ffmpeg'], ['wrong/id']]) expect(() => serviceMembers({...group,typeConfig:{members}})).toThrow();
    });
    it('advertises only public transport information and rejects credentials', () => {
        expect(endpointDescriptor(endpoint,host)).toMatchObject({id:`${host}.ffmpeg`,recipeId:'ffmpeg',instanceId:host,transportConfig:{type:'webrtc'}});
        expect(endpointDescriptor(endpoint,host).transportConfig).not.toHaveProperty('url');
        expect(readEndpointTransport({...endpoint,typeConfig:{...endpoint.typeConfig,transportUrl:'ws://user:secret@localhost/ws'}},host)).toBeNull();
    });
});
