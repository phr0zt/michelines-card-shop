import { Save, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CATEGORIES, CONDITIONS, GRADING_COMPANIES } from '@shared/constants';
import type { CardDetail } from '@shared/types';
import { Button } from '../../../components/ui/Button';
import { Alert } from '../../../components/ui/Feedback';
import { Checkbox, Field, Input, Select, Textarea, TextField } from '../../../components/ui/Form';
import { Panel } from '../../../components/ui/Panel';
import { useToast } from '../../../components/ui/Toast';
import { api, errorMessage } from '../../../lib/api';
import { useApplyCard, useFacets } from '../../../lib/queries';
import { useSyncedForm } from '../../../lib/useSyncedForm';
import { useReportUnsaved } from './unsaved';

const FIELDS = [
  'category',
  'player',
  'team',
  'year',
  'brand',
  'set_name',
  'subset',
  'card_number',
  'parallel',
  'serial_number',
  'is_rookie',
  'is_autograph',
  'is_memorabilia',
  'is_graded',
  'grading_company',
  'grade',
  'cert_number',
  'condition',
  'condition_notes',
  'quantity',
  'location_binder',
  'location_page',
  'location_slot',
  'tags',
] as const;

type FieldName = (typeof FIELDS)[number];
type Values = Pick<CardDetail, FieldName>;

function pickValues(card: CardDetail): Values {
  return Object.fromEntries(FIELDS.map((f) => [f, card[f]])) as Values;
}

export function DetailsForm({ card, locked }: { card: CardDetail; locked: boolean }) {
  const facets = useFacets().data;
  const toast = useToast();
  const applyCard = useApplyCard();
  const server = useMemo(() => pickValues(card), [card]);
  const form = useSyncedForm<Values>(server);
  const { values, set, dirty, serverChanged } = form;
  const [busy, setBusy] = useState(false);

  async function save(): Promise<boolean> {
    setBusy(true);
    try {
      const detail = await api.updateCard(card.id, form.changes());
      applyCard(detail);
      form.markSaved(pickValues(detail));
      toast.success('Card details saved');
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  useReportUnsaved('details', 'card details', dirty, save);

  const categories = (CATEGORIES as readonly string[]).includes(values.category)
    ? CATEGORIES
    : [values.category, ...CATEGORIES];

  return (
    <Panel
      id="details"
      title="Card details"
      description="What the card is, its condition and where it lives."
      actions={
        dirty ? (
          <>
            <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={form.undo} disabled={busy}>
              Undo
            </Button>
            <Button size="sm" variant="primary" icon={<Save className="size-4" />} onClick={save} loading={busy}>
              Save
            </Button>
          </>
        ) : null
      }
    >
      {locked && (
        <Alert tone="info" className="mb-4" title="The AI is reading the photos">
          These fields fill in by themselves in a moment.
        </Alert>
      )}
      {dirty && serverChanged && (
        <Alert
          tone="warning"
          className="mb-4"
          title="This card was updated while you were editing"
          action={
            <Button size="sm" onClick={form.loadServer}>
              Load latest
            </Button>
          }
        >
          Saving will keep your edits for the fields you changed.
        </Alert>
      )}
      <fieldset disabled={locked} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <Field label="Category" htmlFor="f-category" className="lg:col-span-2">
          <Select id="f-category" value={values.category} onChange={(e) => set('category', e.target.value)}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <TextField
          label="Player / character"
          className="lg:col-span-4"
          value={values.player}
          onChange={(e) => set('player', e.target.value)}
          placeholder="e.g. Wayne Gretzky"
        />
        <TextField
          label="Year / season"
          className="lg:col-span-2"
          value={values.year}
          onChange={(e) => set('year', e.target.value)}
          placeholder="e.g. 1979-80"
          list="dl-years"
        />
        <TextField
          label="Brand"
          className="lg:col-span-2"
          value={values.brand}
          onChange={(e) => set('brand', e.target.value)}
          placeholder="O-Pee-Chee, Upper Deck…"
          list="dl-brands"
        />
        <TextField label="Team" className="lg:col-span-2" value={values.team} onChange={(e) => set('team', e.target.value)} list="dl-teams" />
        <TextField
          label="Set"
          className="lg:col-span-3"
          value={values.set_name}
          onChange={(e) => set('set_name', e.target.value)}
          placeholder="e.g. Upper Deck Series 1"
          list="dl-sets"
        />
        <TextField
          label="Insert / subset"
          className="lg:col-span-3"
          value={values.subset}
          onChange={(e) => set('subset', e.target.value)}
          placeholder="e.g. Young Guns"
        />
        <TextField label="Card #" className="lg:col-span-2" value={values.card_number} onChange={(e) => set('card_number', e.target.value)} />
        <TextField
          label="Parallel / variation"
          className="lg:col-span-2"
          value={values.parallel}
          onChange={(e) => set('parallel', e.target.value)}
          placeholder="e.g. Exclusives"
        />
        <TextField
          label="Serial #"
          className="lg:col-span-2"
          value={values.serial_number}
          onChange={(e) => set('serial_number', e.target.value)}
          placeholder="e.g. 45/100"
        />

        <div className="flex flex-wrap gap-x-6 gap-y-3 rounded-xl bg-surface-2 p-3 sm:col-span-2 lg:col-span-6">
          <Checkbox label="Rookie card (RC)" checked={values.is_rookie} onChange={(e) => set('is_rookie', e.target.checked)} />
          <Checkbox label="Autograph" checked={values.is_autograph} onChange={(e) => set('is_autograph', e.target.checked)} />
          <Checkbox label="Jersey / patch / relic" checked={values.is_memorabilia} onChange={(e) => set('is_memorabilia', e.target.checked)} />
          <Checkbox label="Graded (in a slab)" checked={values.is_graded} onChange={(e) => set('is_graded', e.target.checked)} />
        </div>

        {values.is_graded && (
          <>
            <Field label="Grading company" htmlFor="f-grader" className="lg:col-span-2">
              <Input id="f-grader" list="dl-graders" value={values.grading_company} onChange={(e) => set('grading_company', e.target.value)} />
            </Field>
            <TextField label="Grade" className="lg:col-span-2" value={values.grade} onChange={(e) => set('grade', e.target.value)} placeholder="e.g. 9" />
            <TextField label="Cert #" className="lg:col-span-2" value={values.cert_number} onChange={(e) => set('cert_number', e.target.value)} />
          </>
        )}

        <Field label="Condition" htmlFor="f-condition" className="lg:col-span-2">
          <Select id="f-condition" value={values.condition} onChange={(e) => set('condition', e.target.value)}>
            <option value="">Not set</option>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {values.condition && !(CONDITIONS as readonly string[]).includes(values.condition) && (
              <option value={values.condition}>{values.condition}</option>
            )}
          </Select>
        </Field>
        <Field label="Condition notes" htmlFor="f-cnotes" className="lg:col-span-4">
          <Textarea
            id="f-cnotes"
            rows={2}
            value={values.condition_notes}
            onChange={(e) => set('condition_notes', e.target.value)}
            placeholder="Centering, corners, edges, surface…"
          />
        </Field>

        <TextField
          label="Binder / box"
          className="lg:col-span-2"
          value={values.location_binder}
          onChange={(e) => set('location_binder', e.target.value)}
          list="dl-binders"
          placeholder="e.g. Blue binder 2"
        />
        <TextField label="Page" className="lg:col-span-1" value={values.location_page} onChange={(e) => set('location_page', e.target.value)} />
        <TextField label="Slot" className="lg:col-span-1" value={values.location_slot} onChange={(e) => set('location_slot', e.target.value)} />
        <TextField
          label="Quantity"
          type="number"
          min={Math.max(1, card.quantity_sold)}
          className="lg:col-span-2"
          value={values.quantity}
          onChange={(e) => set('quantity', Math.max(1, Number(e.target.value) || 1))}
          hint={card.quantity_sold > 0 ? `${card.quantity_sold} sold` : 'Copies of this exact card'}
        />
        <TextField
          label="Tags"
          className="sm:col-span-2 lg:col-span-6"
          value={values.tags}
          onChange={(e) => set('tags', e.target.value)}
          placeholder="Words to help you find it, e.g. oilers, 80s, lot-a"
        />
      </fieldset>

      <datalist id="dl-brands">{facets?.brands.map((b) => <option key={b} value={b} />)}</datalist>
      <datalist id="dl-sets">{facets?.sets.map((b) => <option key={b} value={b} />)}</datalist>
      <datalist id="dl-years">{facets?.years.map((b) => <option key={b} value={b} />)}</datalist>
      <datalist id="dl-teams">{facets?.teams.map((b) => <option key={b} value={b} />)}</datalist>
      <datalist id="dl-binders">{facets?.binders.map((b) => <option key={b.name} value={b.name} />)}</datalist>
      <datalist id="dl-graders">{GRADING_COMPANIES.map((g) => <option key={g} value={g} />)}</datalist>
    </Panel>
  );
}
