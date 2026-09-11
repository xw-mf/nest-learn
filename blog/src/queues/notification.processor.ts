import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

// 通知队列的消费者：模拟耗时任务（比如发邮件/推送/生成摘要）
@Processor('notifications')
export class NotificationProcessor extends WorkerHost {
  async process(job: Job): Promise<void> {
    console.log(`[Queue] 开始处理任务 ${job.name}，数据:`, job.data);
    await new Promise((r) => setTimeout(r, 3000)); // 模拟耗时操作
    if (job.name === 'send-comment-notification') {
      console.log(`[Queue] 任务完成 ${job.name}（文章 ${job.data.articleId} 的评论通知已"发送"）`);
    } else if (job.name === 'send-publish-notification') {
      console.log(`[Queue] 任务完成 ${job.name}（文章 ${job.data.articleId} 的发布通知已"发送"）`);
    }
  }
}
