"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteProject, ProjectSummary } from "@/actions/projects";

// ─── Props ────────────────────────────────────────────────────────────────────

interface DeleteProjectModalProps {
  project: ProjectSummary;
  children: React.ReactNode;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DeleteProjectModal({
  project,
  children,
}: DeleteProjectModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      try {
        await deleteProject(project.id);
        toast.success("Project deleted.");
        router.refresh();
      } catch {
        toast.error("Failed to delete project. Please try again.");
      }
    });
  };

  return (
    <Dialog>
      <DialogTrigger className="cursor-pointer">{children}</DialogTrigger>
      <DialogContent className="border-white/8 bg-[#111111] text-white sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-white/90">
            Delete project?
          </DialogTitle>
          <DialogDescription className="text-xs text-white/35">
            &ldquo;{project.title ?? "Untitled project"}&rdquo; will be
            permanently deleted. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2">
          <DialogClose>
            <span className="text-xs text-white/40 hover:text-white/70 pr-2">
              Cancel
            </span>
          </DialogClose>
          <Button
            size="sm"
            onClick={handleDelete}
            disabled={isPending}
            className="h-8 rounded-full bg-red-500/90 px-4 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            {isPending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
