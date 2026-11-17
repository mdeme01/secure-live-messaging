import { Route } from '@angular/router';
import { SENDER_ROUTE } from '@slm/crypto';

export const appRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./pages/landing/landing.page').then((m) => m.LandingPage),
  },
  {
    path: `${SENDER_ROUTE}/:id`,
    loadComponent: () => import('./pages/sender/sender.page').then((m) => m.SenderPage),
  },
  { path: '**', redirectTo: '' },
];
