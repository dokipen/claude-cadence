import { useEffect } from "react";
import { useProjects } from "../hooks/useProjects";
import styles from "../styles/layout.module.css";

export const STORAGE_KEY = "cadence_project_id";

interface ProjectSelectorProps {
  selectedProjectId: string | null;
  onProjectChange: (projectId: string) => void;
}

export function ProjectSelector({
  selectedProjectId,
  onProjectChange,
}: ProjectSelectorProps) {
  const { projects, loading } = useProjects();

  // Auto-select first project if nothing stored
  useEffect(() => {
    if (projects.length === 0) return;

    if (!selectedProjectId) {
      const stored = localStorage.getItem(STORAGE_KEY);
      const valid = stored && projects.some((p) => p.id === stored);
      const id = valid ? stored! : projects[0].id;
      localStorage.setItem(STORAGE_KEY, id);
      onProjectChange(id);
    }
  }, [projects, selectedProjectId, onProjectChange]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    localStorage.setItem(STORAGE_KEY, id);
    onProjectChange(id);
  };

  if (loading) {
    return <span className={styles.projectLoading}>Loading projects…</span>;
  }

  return (
    <select
      className={styles.projectSelector}
      value={selectedProjectId ?? ""}
      onChange={handleChange}
      data-testid="project-selector"
    >
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </select>
  );
}
