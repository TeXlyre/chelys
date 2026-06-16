// src/hooks/useRoom.ts
import { useContext } from 'react';

import { RoomContext } from '../contexts/RoomContext';

export const useRoom = () => useContext(RoomContext);
