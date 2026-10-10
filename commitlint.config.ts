export default {
  extends: ['@commitlint/config-conventional'],
  parserPreset: {
    parserOpts: {
      headerCorrespondence: ['emoji', 'type', 'subject'],
      headerPattern: /^(\S+)\s([a-z]+(?:-[a-z]+)*):\s(.+)$/,
    },
  },
}
