// src/plugin-host/routeHooks.ts
import type { Recipe } from './types';
import { removeRoute, writeRoute } from './traefikRoutes';

type Hook = (recipe: Recipe) => void;

export const withRouteStart =
    (inner: Hook): Hook =>
        (recipe) => {
            inner(recipe);
            void writeRoute(recipe);
        };

export const withRouteStop =
    (inner: Hook): Hook =>
        (recipe) => {
            inner(recipe);
            void removeRoute(recipe);
        };
