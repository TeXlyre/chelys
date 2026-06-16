// src/hooks/usePluginHost.ts
import { useContext } from 'react';

import { PluginHostContext } from '../contexts/PluginHostContext';

export const usePluginHost = () => useContext(PluginHostContext);
