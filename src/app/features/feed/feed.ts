import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { DbService } from '../../core/db/db.service';
import { Article, User } from '../../core/models/interfaces';
import { SeoService } from '../../core/services/seo.service';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './feed.html',
  styleUrl: './feed.scss'
})
export class FeedComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);
  readonly searchQuery = signal('');
  readonly selectedTag = signal<string | null>(null);
  readonly mobileNavOpen = signal(false);

  toggleMobileNav() { this.mobileNavOpen.update(v => !v); }
  closeMobileNav()  { this.mobileNavOpen.set(false); }

  readonly activeFeedTab = signal<'discover' | 'following'>('discover');

  // Recommendation algorithm for "Descobrir" feed
  readonly discoverArticles = computed(() => {
    const me = this.db.currentUser();
    const allArticles = this.db.articles().filter(art => !art.status || art.status === 'published');
    
    if (!me) {
      // Guest users: sort by popularity and time decay
      return [...allArticles].sort((a, b) => {
        const scoreA = (a.likesCount * 2 + a.commentsCount * 3);
        const hoursA = (Date.now() - new Date(a.createdAt).getTime()) / (1000 * 60 * 60);
        const finalScoreA = scoreA / (1 + hoursA * 0.05);
        
        const scoreB = (b.likesCount * 2 + b.commentsCount * 3);
        const hoursB = (Date.now() - new Date(b.createdAt).getTime()) / (1000 * 60 * 60);
        const finalScoreB = scoreB / (1 + hoursB * 0.05);
        
        return finalScoreB - finalScoreA;
      });
    }

    // Authenticated users: interest match, new creator boost, popularity, recency decay
    const likedIds = this.db.likes()
      .filter(l => l.userId === me.id)
      .map(l => l.articleId);

    const favoriteTags = new Map<string, number>();
    this.db.articles()
      .filter(art => likedIds.includes(art.id))
      .forEach(art => {
        art.tags?.forEach(tag => {
          favoriteTags.set(tag, (favoriteTags.get(tag) || 0) + 1);
        });
      });

    const scored = allArticles.map(art => {
      let tagScore = 0;
      art.tags?.forEach(tag => {
        tagScore += (favoriteTags.get(tag) || 0) * 10;
      });

      const isOwnPost = (art.blogId || art.authorId) === me.id;
      const isFollowed = this.db.isFollowing(art.blogId || art.authorId);
      
      let creatorBoost = 0;
      if (!isOwnPost && !isFollowed) {
        creatorBoost = 15;
      }

      const popularity = art.likesCount * 2 + art.commentsCount * 3;
      const hours = (Date.now() - new Date(art.createdAt).getTime()) / (1000 * 60 * 60);
      
      const rawScore = tagScore + creatorBoost + popularity + 10;
      const finalScore = rawScore / (1 + hours * 0.02);

      return { article: art, score: finalScore };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .map(item => item.article);
  });

  // "Seguindo" feed
  readonly followingArticles = computed(() => {
    const me = this.db.currentUser();
    if (!me) return [];
    return this.db.articles().filter(art => {
      const isPublished = !art.status || art.status === 'published';
      const isFollowed = this.db.isFollowing(art.blogId || art.authorId);
      return isPublished && isFollowed;
    });
  });

  // Filtered articles based on selected tab and search/tag parameters
  readonly filteredArticles = computed(() => {
    let list = this.activeFeedTab() === 'discover' ? this.discoverArticles() : this.followingArticles();
    const query = this.searchQuery().toLowerCase().trim();
    const tag = this.selectedTag();

    if (query) {
      list = list.filter(art => 
        art.title.toLowerCase().includes(query) || 
        art.summary.toLowerCase().includes(query) ||
        art.tags.some(t => t.toLowerCase().includes(query))
      );
    }

    if (tag) {
      list = list.filter(art => art.tags.includes(tag));
    }

    return list;
  });

  // Get all unique tags
  readonly allTags = computed(() => {
    const tags = new Set<string>();
    this.db.articles()
      .filter(art => !art.status || art.status === 'published')
      .forEach(art => {
        art.tags.forEach(t => tags.add(t));
      });
    return Array.from(tags);
  });

  // Creators list (excluding current user)
  readonly otherCreators = computed(() => {
    const current = this.db.currentUser();
    return this.db.users().filter(u => !current || u.id !== current.id);
  });

  constructor(public db: DbService) {}

  ngOnInit() {
    this.seo.updateTags({
      title: 'GuiikHub',
      description: 'Descubra e crie artigos incríveis sobre tudo o que você ama.',
      route: ''
    });
  }

  selectTag(tag: string | null) {
    this.selectedTag.set(tag);
  }

  toggleLike(event: Event, articleId: string) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.db.isAuthenticated()) {
      this.router.navigate(['/auth']);
      return;
    }
    this.db.toggleLike(articleId);
  }

  toggleFollow(event: Event, creatorId: string) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.db.isAuthenticated()) {
      this.router.navigate(['/auth']);
      return;
    }
    this.db.toggleFollow(creatorId);
  }
}
