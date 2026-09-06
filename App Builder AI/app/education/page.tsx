import { ProductPage } from '@/components/marketing/product-page';

export default function EducationPage() {
  return (
    <ProductPage
      eyebrow="Company"
      title="Education"
      description="Special access and resources for students, teachers, and schools using AppWeaver AI to learn and teach app building."
      highlights={[
        {
          title: "For students",
          description:
            "Learn to build real apps hands-on, without needing to know how to code first.",
        },
        {
          title: "For educators",
          description:
            "Bring project-based learning into the classroom with a tool students can use immediately.",
        },
        {
          title: "Course resources",
          description:
            "Lesson plans and example projects designed for a classroom setting.",
        },
        {
          title: "Apply for access",
          description:
            "Schools and student organizations can apply for education pricing.",
        },
      ]}
    />
  );
}
