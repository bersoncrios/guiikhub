import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

export interface SeoConfig {
  title?: string;
  description?: string;
  image?: string;
  route?: string;
  tags?: string[];
  author?: string;
  type?: 'website' | 'article' | 'profile';
}

@Injectable({
  providedIn: 'root'
})
export class SeoService {
  private title = inject(Title);
  private meta = inject(Meta);

  private readonly siteName = 'GuiikHub';
  private readonly baseUrl = 'https://guiikhub.com';
  private readonly defaultCover = 'https://guiikhub.com/images/logo-guiikhub.png';

  updateTags(config: SeoConfig) {
    const fullTitle = config.title 
      ? (config.title.includes('GuiikHub') ? config.title : `${config.title} | ${this.siteName}`)
      : `${this.siteName} — Toda paixão merece um espaço.`;
      
    const description = config.description || 'Descubra e crie artigos incríveis sobre tudo o que você ama no GuiikHub.';
    const imageUrl = config.image || this.defaultCover;
    const url = config.route ? `${this.baseUrl}${config.route}` : this.baseUrl;
    const type = config.type || 'website';

    // Title
    this.title.setTitle(fullTitle);
    this.meta.updateTag({ property: 'og:title', content: fullTitle });
    this.meta.updateTag({ name: 'twitter:title', content: fullTitle });

    // Description
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ name: 'twitter:description', content: description });

    // Image
    this.meta.updateTag({ property: 'og:image', content: imageUrl });
    this.meta.updateTag({ name: 'twitter:image', content: imageUrl });
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });

    // URL & Type
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ property: 'og:type', content: type });
    this.meta.updateTag({ property: 'og:site_name', content: this.siteName });

    // Optional Tags
    if (config.tags && config.tags.length > 0) {
      this.meta.updateTag({ name: 'keywords', content: config.tags.join(', ') });
    }

    if (config.author) {
      this.meta.updateTag({ name: 'author', content: config.author });
    }
  }

  reset() {
    this.updateTags({});
  }
}
