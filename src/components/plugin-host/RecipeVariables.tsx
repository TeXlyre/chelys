// src/components/plugin-host/RecipeVariables.tsx
import type React from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import { usePluginHost } from '../../hooks/usePluginHost';
import { effectiveValues } from '../../plugin-host/variableResolution';
import type { Recipe } from '../../plugin-host/types';

interface RecipeVariablesProps {
    recipe: Recipe;
    onDone: () => void;
}

const RecipeVariables: React.FC<RecipeVariablesProps> = ({ recipe, onDone }) => {
    const { setVariables } = usePluginHost();
    const [values, setValues] = useState<Record<string, string>>(() =>
        effectiveValues(recipe),
    );

    if (!recipe.variables || recipe.variables.length === 0) return null;

    const update = (key: string, value: string) =>
        setValues((prev) => ({ ...prev, [key]: value }));

    const handleSave = async () => {
        await setVariables(recipe.id, values);
        onDone();
    };

    return (
        <div className='recipe-variables'>
            {recipe.variables.map((variable) => (
                <div key={variable.key} className='form-group'>
                    <label>{t(variable.label)}</label>
                    {variable.kind === 'select' ? (
                        <select
                            value={values[variable.key] ?? ''}
                            onChange={(e) => update(variable.key, e.target.value)}
                        >
                            {(variable.options ?? []).map((option) => (
                                <option key={option} value={option}>
                                    {option}
                                </option>
                            ))}
                        </select>
                    ) : variable.kind === 'boolean' ? (
                        <input
                            type='checkbox'
                            checked={values[variable.key] === 'true'}
                            onChange={(e) =>
                                update(variable.key, e.target.checked ? 'true' : 'false')
                            }
                        />
                    ) : (
                        <input
                            type={variable.kind === 'number' ? 'number' : 'text'}
                            value={values[variable.key] ?? ''}
                            onChange={(e) => update(variable.key, e.target.value)}
                        />
                    )}
                    {variable.help && <small>{t(variable.help)}</small>}
                </div>
            ))}
            <div className='form-actions'>
                <button className='button' onClick={onDone}>
                    {t('Cancel')}
                </button>
                <button className='button primary' onClick={handleSave}>
                    {t('Save settings')}
                </button>
            </div>
        </div>
    );
};

export default RecipeVariables;