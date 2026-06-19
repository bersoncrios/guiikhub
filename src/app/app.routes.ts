import { Routes } from '@angular/router';
import { FeedComponent } from './features/feed/feed';
import { AdminComponent } from './features/admin/admin';
import { BlogComponent } from './features/blog/blog';
import { ArticleDetailComponent } from './features/blog/article-detail';
import { AuthComponent } from './features/auth/auth';

export const routes: Routes = [
  {
    path: '',
    component: FeedComponent,
    title: 'GuiikHub — Toda paixão merece um espaço.'
  },
  {
    path: 'admin',
    component: AdminComponent,
    title: 'GuiikHub - Estúdio Criador'
  },
  {
    path: 'auth',
    component: AuthComponent,
    title: 'GuiikHub - Entrar / Cadastrar'
  },
  {
    path: 'b/:username',
    component: BlogComponent
  },
  {
    path: 'b/:username/post/:slug',
    component: ArticleDetailComponent
  },
  {
    path: '**',
    redirectTo: ''
  }
];
