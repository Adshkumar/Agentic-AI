"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Trash2, MessageSquare } from "lucide-react";
import { ProjectSummary } from "@/actions/projects";
import { DeleteProjectModal } from "./DeleteProjectModal";

interface ProjectCardProps {
  projects: ProjectSummary[];
}

export function ProjectCard({ projects }: ProjectCardProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => {
        const title = project.title ?? "Untitled project";
        const timeAgo = formatDistanceToNow(new Date(project.updatedAt), {
          addSuffix: true,
        });
        const msgCount = Math.floor(project.messageCount / 2);

        return (
          <div
            key={project.id}
            className="group relative flex flex-col rounded-xl border border-white/6 bg-[#0f0f0f] p-4 transition-colors hover:border-white/10 hover:bg-[#111111]"
          >
            <Link
              href={`/workspace?id=${project.id}`}
              className="absolute inset-0 rounded-xl"
              aria-label={`Open ${title}`}
            />

            {/* Top row */}
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="line-clamp-1 text-sm font-medium leading-snug text-white/80">
                {title}
              </p>
              <DeleteProjectModal project={project}>
                <span className="relative z-10 text-white/20 hover:text-red-400">
                  <Trash2 className="h-3.5 w-3.5" />
                </span>
              </DeleteProjectModal>
            </div>

            {/* First prompt preview */}
            {project.firstPrompt && (
              <p className="mb-3 line-clamp-2 text-[12px] leading-relaxed text-white/30">
                {project.firstPrompt}
              </p>
            )}

            {/* Meta */}
            <div className="mt-auto flex items-center gap-3 pt-2 border-t border-white/4">
              <span className="flex items-center gap-1 text-[11px] text-white/25">
                <MessageSquare className="h-3 w-3" />
                {msgCount} message{msgCount !== 1 ? "s" : ""}
              </span>
              <span className="text-[11px] text-white/20">{timeAgo}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
