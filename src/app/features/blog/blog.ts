import { Component, computed, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title, Meta } from '@angular/platform-browser';
import { DbService } from '../../core/db/db.service';

@Component({
  selector: 'app-blog',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './blog.html',
  styleUrl: './blog.scss'
})
export class BlogComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  public readonly db = inject(DbService);

  // Convert route params to a Signal
  private readonly params = toSignal(this.route.params);
  
  // Extract username from params
  readonly username = computed(() => this.params()?.['username'] || '');

  // Find user by username
  readonly blogUser = computed(() => {
    const name = this.username().toLowerCase().trim();
    if (!name) return null;
    return this.db.users().find(u => u.username === name) || null;
  });

  // Get articles of the user
  readonly blogArticles = computed(() => {
    const user = this.blogUser();
    if (!user) return [];
    return this.db.articles().filter(art => art.authorId === user.id);
  });

  // Build custom CSS variables map for the wrapper
  readonly customStyleVariables = computed(() => {
    const user = this.blogUser();
    if (!user) return {};
    const s = user.blogSettings;
    
    // Map font choices to css strings
    let fontStr = 'var(--font-sans)';
    if (s.fontFamily === 'Space Grotesk') fontStr = 'var(--font-display)';
    else if (s.fontFamily === 'Fira Code') fontStr = 'var(--font-mono)';

    return {
      '--blog-bg': s.bgColor,
      '--blog-card-bg': s.cardBgColor,
      '--blog-border': 'rgba(255, 255, 255, 0.08)',
      '--blog-primary': s.primaryColor,
      '--blog-accent': s.accentColor,
      '--blog-text': s.textColor,
      '--blog-text-muted': '#94a3b8',
      '--blog-font-family': fontStr,
      '--blog-glow': `0 0 20px ${s.accentColor}40`
    } as Record<string, string>;
  });

  constructor() {
    // Update browser tab title and meta tags when blog user loads
    effect(() => {
      const user = this.blogUser();
      if (user) {
        const blogTitle = user.blogSettings?.title || user.displayName;
        const fullTitle = `${blogTitle} — GuiikHub`;
        const description = user.blogSettings?.tagline || user.bio || 'Confira o meu blog no GuiikHub!';
        const imageUrl = user.blogSettings?.bannerUrl || user.bannerUrl || 'https://guiikhub.vercel.app/images/cyberpunk_cover.png';
        
        this.titleService.setTitle(fullTitle);
        
        this.metaService.updateTag({ property: 'og:title', content: fullTitle });
        this.metaService.updateTag({ property: 'og:description', content: description });
        this.metaService.updateTag({ property: 'og:image', content: imageUrl });
        this.metaService.updateTag({ property: 'og:type', content: 'website' });
        
        this.metaService.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
        this.metaService.updateTag({ name: 'twitter:title', content: fullTitle });
        this.metaService.updateTag({ name: 'twitter:description', content: description });
        this.metaService.updateTag({ name: 'twitter:image', content: imageUrl });

      } else if (this.username()) {
        const fallbackTitle = `@${this.username()} — GuiikHub`;
        this.titleService.setTitle(fallbackTitle);
        this.metaService.updateTag({ property: 'og:title', content: fallbackTitle });
      }
    });
  }

  toggleFollow(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.db.isAuthenticated()) {
      this.router.navigate(['/auth']);
      return;
    }
    const user = this.blogUser();
    if (user) {
      this.db.toggleFollow(user.id);
    }
  }
}
