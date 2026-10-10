export default {
  extends: ['@commitlint/config-conventional'],
  parserPreset: {
    parserOpts: {
      headerCorrespondence: ['emoji', 'type', 'subject'],
      headerPattern:
        /^(\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?|[\u{1F3FB}-\u{1F3FF}])*)\s([a-z]+(?:-[a-z]+)*):\s(.+)$/u,
    },
  },
}
