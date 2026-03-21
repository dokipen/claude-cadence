import { useEffect } from "react";
import { useProjects } from "../hooks/useProjects";
import styles from "../styles/layout.module.css";

interface ProjectSelectorProps {
  selectedProjectId: string | null;
  onProjectChange: (projectId: string) => void;
}

export function ProjectSelector({
  selectedProjectId,
  onProjectChange,
}: ProjectSelectorProps) {
  const { projects, loading } = useProjects();

  // If the URL has an invalid project ID, redirect to first valid project
  useEffect(() => {
    if (projects.length === 0) return;
    if (!selectedProjectId || !projects.some((p) => p.id === selectedProjectId)) {
      onProjectChange(projects[0].id);
    }
  }, [projects, selectedProjectId, onProjectChange]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (!projects.some((p) => p.id === id)) return;
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
