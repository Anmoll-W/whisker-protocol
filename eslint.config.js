// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Ban unseeded randomness — use getRNG() from @/systems/rng instead.
      //
      // Math.random() — direct call; banned everywhere.
      // Phaser.Math.Between() and Phaser.Math.FloatBetween() — delegate to Phaser's
      // unseeded Math.RND; banned everywhere. Use getRNG().between() /
      // getRNG().realInRange() instead.
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Math.random() is banned. Use getRNG() from @/systems/rng (seeded RandomDataGenerator).',
        },
      ],
      // Catch Phaser.Math.Between and Phaser.Math.FloatBetween via AST selector.
      // We cannot use no-restricted-properties for a chained a.b.c() call, so we
      // use no-restricted-syntax with a MemberExpression selector instead.
      'no-restricted-syntax': [
        'error',
        {
          // Matches any call: Phaser.Math.Between(...)
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.type='MemberExpression'][callee.object.object.name='Phaser'][callee.object.property.name='Math'][callee.property.name='Between']",
          message:
            'Phaser.Math.Between() is banned (unseeded). Use getRNG().between() from @/systems/rng.',
        },
        {
          // Matches any call: Phaser.Math.FloatBetween(...)
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.type='MemberExpression'][callee.object.object.name='Phaser'][callee.object.property.name='Math'][callee.property.name='FloatBetween']",
          message:
            'Phaser.Math.FloatBetween() is banned (unseeded). Use getRNG().realInRange() from @/systems/rng.',
        },
      ],
    },
  },
  {
    // Ignore generated / vendor paths
    ignores: ['dist/**', 'node_modules/**', 'public/**'],
  },
);
