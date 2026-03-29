#!/usr/bin/env python3
import os
import re
import shutil

# Mapping of Claude tools to Gemini tools
TOOL_MAPPING = {
    "Read": "read_file",
    "Edit": "replace",
    "Write": "write_file",
    "Glob": "glob",
    "Grep": "grep_search",
    "Bash": "run_shell_command",
    "WebFetch": "web_fetch",
    "WebSearch": "google_web_search",
    "Search": "grep_search"
}

def update_content(content):
    """Updates tool names and terminology in the body of the markdown."""
    for claude_tool, gemini_tool in TOOL_MAPPING.items():
        content = content.replace(f"`{claude_tool}`", f"`{gemini_tool}`")
        content = content.replace(f" {claude_tool} tool", f" {gemini_tool} tool")
        content = content.replace(f" {claude_tool} ", f" {gemini_tool} ")
        content = content.replace(f" {claude_tool},", f" {gemini_tool},")
        content = content.replace(f" {claude_tool}.", f" {gemini_tool}.")
    
    # Update Terminology
    content = content.replace("Claude Code", "Gemini CLI")
    content = content.replace("Claude Agent SDK", "Gemini CLI SDK")
    content = content.replace("using the Agent tool", "using sub-agent delegation (e.g., @agent-name)")
    content = content.replace("Agent tool calls", "sub-agent delegation")
    content = content.replace("built-in Agent tool type", "built-in generalist agent")
    
    # Update script paths
    content = content.replace("bash skills/", "run_shell_command skills/")
    content = content.replace("bash commands/", "run_shell_command commands/")
    
    return content

def convert_frontmatter(content, is_agent=False):
    """Converts YAML frontmatter from Claude style to Gemini style."""
    lines = content.splitlines()
    if not lines or lines[0] != "---":
        return content

    end_index = -1
    for i in range(1, len(lines)):
        if lines[i] == "---":
            end_index = i
            break
    
    if end_index == -1:
        return content

    frontmatter_lines = lines[1:end_index]
    body = lines[end_index+1:]
    
    new_fm = []
    if is_agent:
        new_fm.append("kind: local")
    
    for line in frontmatter_lines:
        if line.startswith("tools:"):
            # Convert CSV to list
            tools_str = line.split(":", 1)[1].strip()
            claude_tools = [t.strip() for t in tools_str.split(",") if t.strip()]
            gemini_tools = [TOOL_MAPPING.get(t, t) for t in claude_tools]
            new_fm.append("tools:")
            for t in gemini_tools:
                new_fm.append(f"  - {t}")
        elif line.startswith("model:"):
            # Map models to gemini defaults
            new_fm.append("model: gemini-2.0-flash-exp")
        elif line.startswith("disable-model-invocation:"):
            # Gemini doesn't use this flag in skills
            continue
        else:
            new_fm.append(line)
            
    # Rename specialists
    new_fm = [line.replace("claude-specialist", "gemini-specialist") for line in new_fm]
    
    return "---\n" + "\n".join(new_fm) + "\n---\n" + "\n".join(body)

def sync_dir(src_root, dest_root, is_agent=False):
    """Recursively syncs and converts a directory."""
    if not os.path.exists(src_root):
        return

    os.makedirs(dest_root, exist_ok=True)
    
    for item in os.listdir(src_root):
        s = os.path.join(src_root, item)
        d = os.path.join(dest_root, item)
        
        if os.path.isdir(s):
            sync_dir(s, d, is_agent)
        elif s.endswith(".md"):
            with open(s, "r") as f:
                content = f.read()
            
            # Special case for specialists rename
            if item == "claude-specialist.md":
                d = os.path.join(dest_root, "gemini-specialist.md")
            
            content = convert_frontmatter(content, is_agent)
            content = update_content(content)
            
            with open(d, "w") as f:
                f.write(content)
        else:
            # Copy other files (scripts, etc.) as is
            shutil.copy2(s, d)

if __name__ == "__main__":
    print("Syncing Claude -> Gemini...")
    
    # Sync Agents
    sync_dir("agents", ".gemini/agents", is_agent=True)
    
    # Sync Skills
    sync_dir("skills", ".gemini/skills")
    
    # Sync Commands (move their logic to skills for Gemini)
    sync_dir("commands", ".gemini/skills")
    
    print("Done! .gemini/ directory is up to date.")
