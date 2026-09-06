import type { BuildDefinition } from './catalog'
import type { MarkdownBuildRequirements } from './markdown'

export function expandMarkdownBuildRequirements(
  requirements: MarkdownBuildRequirements,
  base: Omit<BuildDefinition, 'id' | 'requiredSkills'>,
): BuildDefinition[] {
  return requirements.requiredSkillGroups.reduce<BuildDefinition[]>(
    (definitions, group, groupIndex) => {
      if (group.length === 0) {
        return definitions
      }

      if (definitions.length === 0) {
        return group.map(skill => ({
          ...base,
          id: `${requirements.id}-${groupIndex + 1}`,
          requiredSkills: [skill],
        }))
      }

      return definitions.flatMap(definition => group.map(skill => ({
        ...definition,
        id: `${definition.id}-${groupIndex + 1}`,
        requiredSkills: [...definition.requiredSkills, skill],
      })))
    },
    [],
  )
}
