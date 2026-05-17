import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
    {
        ignores: ["node_modules/**", "dist/**", "build/**", "**/*.d.ts"]
    },
    {
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: {
            parser: tsparser
        },
        plugins: {
            "@typescript-eslint": tseslint
        },
        rules: {
            "@typescript-eslint/naming-convention": [
                "warn",
                {
                    "selector": "default",
                    "format": ["snake_case"]
                },
                {
                    "selector": "import",
                    "format": ["camelCase", "PascalCase", "snake_case"]
                },
                // Allow UPPER_CASE for constants
                {
                    "selector": "variable",
                    "modifiers": ["const"],
                    "format": ["snake_case", "UPPER_CASE"],
                    "filter": {
                        "regex": "^.*[a-z].*[A-Z].*$|^.*[A-Z].*[a-z].*[A-Z].*$", // Target sizes with bibytes
                        "match": false
                    },
                    "leadingUnderscore": "allow"
                },
                // Allow UPPER_CASE for object properties (your config objects)
                {
                    "selector": "objectLiteralProperty",
                    "format": null
                },
                // Allow UPPER_CASE for type properties
                {
                    "selector": "typeProperty",
                    "format": ["snake_case", "UPPER_CASE"]
                },
                // Allow snake_case OR PascalCase for interfaces/types
                {
                    "selector": "typeLike",
                    "format": ["PascalCase", "snake_case"]
                },
                {
                    "selector": "parameter",
                    "format": ["snake_case"],
                    "leadingUnderscore": "allow"
                },
                // Allow UPPER_CASE, PascalCase, and snake_case for enum members
                {
                    "selector": "enumMember",
                    "format": ["snake_case", "UPPER_CASE", "PascalCase"]
                },
                // Allow camelCase for functions (since you have existing camelCase functions)
                {
                    "selector": "function",
                    "format": ["snake_case", "camelCase"]
                },
                // Allow camelCase for regular (non-const) variables too
                {
                    "selector": "variable",
                    "format": ["snake_case", "camelCase", "UPPER_CASE"]
                },
            ]
        }
    }
];