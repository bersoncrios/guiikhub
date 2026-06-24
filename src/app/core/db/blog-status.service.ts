import { Injectable, inject } from '@angular/core';
import { User, BlogStatus } from '../models/interfaces';
import { Firestore, doc, setDoc, deleteDoc } from '@angular/fire/firestore';

@Injectable({
  providedIn: 'root'
})
export class BlogStatusService {
  private readonly firestore = inject(Firestore);

  async addBlogStatus(content: string, user: User, targetBlogId?: string): Promise<BlogStatus | null> {
    const id = 'status_' + Date.now();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    const newStatus: BlogStatus = {
      id,
      authorId: user.id,
      blogId: targetBlogId || user.id,
      content,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    await setDoc(doc(this.firestore, `blog_statuses/${id}`), newStatus);
    return newStatus;
  }

  async deleteBlogStatus(id: string) {
    await deleteDoc(doc(this.firestore, `blog_statuses/${id}`));
  }
}
