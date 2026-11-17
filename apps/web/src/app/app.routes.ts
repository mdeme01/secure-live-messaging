import { Route } from '@angular/router';
import { RECEIVER_ROUTE, SENDER_ROUTE } from '@slm/crypto';

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
  {
    path: `${RECEIVER_ROUTE}/:id`,
    loadComponent: () => import('./pages/receiver/receiver.page').then((m) => m.ReceiverPage),
  },
  {
    path: '**',
    loadComponent: () => import('./pages/not-found/not-found.page').then((m) => m.NotFoundPage),
  },
];
