import { createContext, useContext } from 'react';
import type { CardInstance } from '../engine/types';

// Lets any CardView, however deep, set the hover-preview card without prop drilling.
export const HoverCtx = createContext<(c: CardInstance | null) => void>(() => {});
export const useSetHover = () => useContext(HoverCtx);
