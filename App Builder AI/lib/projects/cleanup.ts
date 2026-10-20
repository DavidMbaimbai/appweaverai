import { prisma } from '@/lib/prisma';

// Marketing and Investor Hub rows reference projects by plain id (no FK), so they are removed here.
export async function deleteProjectSideData(projectId: string, userId: string) {
  await prisma.$transaction([
    prisma.projectCampaign.deleteMany({ where: { projectId } }),
    prisma.hubInvestorSms.deleteMany({ where: { projectId } }),
    prisma.hubInvestorCall.deleteMany({ where: { projectId } }),
    prisma.hubInvestorContact.deleteMany({ where: { projectId } }),
    prisma.hubInvestor.deleteMany({ where: { projectId } }),
    prisma.investorHubProfile.deleteMany({ where: { projectId } }),
  ]);
  const remaining = await prisma.projectCampaign.count({ where: { userId } });
  if (remaining === 0) {
    await prisma.socialConnection.deleteMany({ where: { userId } });
  }
}
