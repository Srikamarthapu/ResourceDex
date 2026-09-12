'use client';

import { useCallback, useEffect, useRef, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Check,
  Info,
  Leaf,
  MapPin,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useApp } from './app-provider';
import { categoryIcons } from './icons';
import { EmptyState, Loading, Notice } from './ui';
import { ResourceCard } from './resource-card';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import { getResourceImageUrl, listAreas, listResources } from '@/lib/data/resources';
import { categories, categoryLabels, type Category } from '@/lib/types';
import { sampleAreas, sampleResources } from '@/lib/sample-resources';
import { useLiveQuery } from '@/lib/use-live-query';

export function Explore() {
  const { configured } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const category = categories.includes(params.get('category') as Category)
    ? (params.get('category') as Category)
    : '';
  const area = params.get('area') || '';
  const search = params.get('q') || '';
  const page = Math.max(0, Number(params.get('page')) || 0);
  const includeReserved = params.get('availability') === 'all';
  const samples = params.get('samples') === '1' || !configured;
  const searchInput = useRef<HTMLInputElement>(null);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    router.push(`/?${next.toString()}`, { scroll: false });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === '/' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName)
      ) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const load = useCallback(async () => {
    if (samples)
      return {
        resources: sampleResources.filter(
          (item) =>
            (!category || item.category === category) &&
            (!area || item.area_id === area) &&
            (!search ||
              `${item.title} ${item.description} ${item.category}`
                .toLowerCase()
                .includes(search.toLowerCase())),
        ),
        areas: sampleAreas,
        images: Object.fromEntries(sampleResources.map((item) => [item.id, item.image_path])),
      };
    const client = createBrowserSupabaseClient();
    const [resources, areas] = await Promise.all([
      listResources(client, { category, areaId: area, search, page, includeReserved }),
      listAreas(client),
    ]);
    const images = Object.fromEntries(
      await Promise.all(
        resources.map(async (item) => [item.id, await getResourceImageUrl(client, item)]),
      ),
    );
    return { resources, areas, images };
  }, [samples, category, area, search, page, includeReserved]);
  const { data, loading, error, refresh } = useLiveQuery(load);
  const items = data?.resources ?? [];
  const areas = data?.areas ?? [];
  const chooseCategory = (value: string) => update('category', value);
  function submitSearch(event: FormEvent) {
    event.preventDefault();
    update('q', searchInput.current?.value.trim() || '');
  }
  const categoryButtons = (
    <>
      {[['', 'All materials'], ...categories.map((key) => [key, categoryLabels[key]])].map(
        ([key, label]) => {
          const Icon = key ? categoryIcons[key as Category] : Boxes;
          return (
            <button
              key={key}
              className={`category-button ${category === key ? 'selected' : ''}`}
              onClick={() => chooseCategory(key)}
              aria-pressed={category === key}
            >
              <Icon size={19} />
              <span>{label}</span>
              {category === key && <Check size={12} style={{ marginLeft: 'auto' }} />}
            </button>
          );
        },
      )}
    </>
  );
  return (
    <div className="page-container explore-layout">
      <aside className="catalog-sidebar">
        <p className="sidebar-title">Browse materials</p>
        <div className="category-list">{categoryButtons}</div>
        <div className="sidebar-line" />
        <p className="sidebar-title">Availability</p>
        <button
          className={`category-button ${!includeReserved ? 'selected' : ''}`}
          onClick={() => update('availability', '')}
          aria-pressed={!includeReserved}
        >
          <span className="status">Available now</span>
        </button>
        <button
          className={`category-button ${includeReserved ? 'selected' : ''}`}
          onClick={() => update('availability', 'all')}
          aria-pressed={includeReserved}
        >
          <SlidersHorizontal size={17} />
          Include reserved
        </button>
        <div className="sidebar-tip">
          <Leaf size={23} strokeWidth={1.4} />
          <h3>
            Spare to you.
            <br />A start for someone.
          </h3>
          <p>That leftover material could be the missing piece of their next project.</p>
          <Link className="text-link" href="/share">
            Share a resource <ArrowUpRight size={13} />
          </Link>
        </div>
        <p className="sidebar-footnote">
          Free to share.
          <br />
          Made for local pickup.
        </p>
      </aside>
      <section className="catalog-main" aria-label="Resource catalog">
        <div className="catalog-hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <span style={{ width: 5, height: 5, background: '#718457', borderRadius: '50%' }} />{' '}
              The community material exchange
            </p>
            <h1>
              Good materials.
              <br />
              <span>New possibilities.</span>
            </h1>
            <p>
              Discover free materials, spare parts, and tools.
              <br />
              Give something useful its next chapter.
            </p>
            <Link href="/share" className="text-link">
              Have something to share? <ArrowRight size={13} />
            </Link>
          </div>
          <div className="hero-art">
            <img src="/images/samples/wood.webp" alt="" width={480} height={300} />
          </div>
          <span className="hero-note">A place for second beginnings</span>
        </div>
        <div className="search-toolbar">
          <form className="search-form" onSubmit={submitSearch} role="search">
            <Search size={18} strokeWidth={1.6} />
            <label htmlFor="resource-search" className="visually-hidden">
              Search materials, tools, and more
            </label>
            <input
              ref={searchInput}
              id="resource-search"
              key={search}
              defaultValue={search}
              placeholder="Search materials, tools, and more…"
            />
            <kbd>/</kbd>
            <button type="submit" className="icon-button" aria-label="Search resources">
              <ArrowRight size={16} />
            </button>
          </form>
          <div className="area-select-wrap">
            <MapPin size={15} />
            <label className="visually-hidden" htmlFor="pickup-area">
              Pickup area
            </label>
            <select
              id="pickup-area"
              value={area}
              onChange={(event) => update('area', event.target.value)}
            >
              <option value="">All pickup areas</option>
              {areas.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mobile-categories">{categoryButtons}</div>
        {(search || area || category) && (
          <div className="active-filters">
            {search && (
              <button
                className="filter-chip"
                onClick={() => {
                  update('q', '');
                }}
              >
                “{search}”<X size={12} />
              </button>
            )}
            {category && (
              <button className="filter-chip" onClick={() => update('category', '')}>
                {categoryLabels[category]}
                <X size={12} />
              </button>
            )}
            {area && (
              <button className="filter-chip" onClick={() => update('area', '')}>
                {areas.find((item) => item.id === area)?.label || area}
                <X size={12} />
              </button>
            )}
          </div>
        )}
        <div className="results-heading">
          <h2>{category ? categoryLabels[category] : 'Find your next project'}</h2>
          {data && <span className="result-count">{items.length} resources</span>}
          <div className="sort-control">
            <span>Showing</span>
            <label className="visually-hidden" htmlFor="availability">
              Availability
            </label>
            <select
              id="availability"
              value={includeReserved ? 'all' : 'available'}
              onChange={(event) =>
                update('availability', event.target.value === 'all' ? 'all' : '')
              }
            >
              <option value="available">Available · newest first</option>
              <option value="all">Available & reserved</option>
            </select>
          </div>
        </div>
        {(samples || items.some((item) => item.is_sample)) && (
          <p className="sample-caption">
            <Info size={12} />
            Sample listings use illustrative photos and are not offered for pickup.
            {configured && samples && <Link href="/">View live resources</Link>}
          </p>
        )}
        {error && (
          <div className="notice-stack">
            <Notice error>
              {error}
              <button className="text-link" onClick={refresh}>
                Retry
              </button>
            </Notice>
          </div>
        )}
        {loading ? (
          <Loading />
        ) : items.length ? (
          <div className="resource-grid">
            {items.map((resource) => (
              <ResourceCard
                key={resource.id}
                resource={resource}
                imageUrl={data?.images[resource.id]}
                area={areas.find((item) => item.id === resource.area_id)?.label || 'Pickup area'}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title={
              search || category || area
                ? 'Nothing here just yet'
                : 'Good things start with a first share'
            }
            href={search || category || area ? '/' : '/share'}
            action={search || category || area ? 'Clear filters' : 'Share the first resource'}
          >
            {search || category || area
              ? 'Try a different material or pickup area, or clear your filters to see more.'
              : 'Your community is ready. Add spare materials or tools and give someone a place to start.'}
          </EmptyState>
        )}
        <div className="catalog-bottom">
          <span>Shared freely. Picked up locally. Ready for something new.</span>
          {items.length === 24 ? (
            <button className="text-link" onClick={() => update('page', String(page + 1))}>
              More resources <ArrowRight size={14} />
            </button>
          ) : (
            <Link className="text-link" href="/about">
              How ResourceDex works <ArrowUpRight size={13} />
            </Link>
          )}
        </div>
        {page > 0 && (
          <button className="button small" onClick={() => update('page', String(page - 1))}>
            Previous page
          </button>
        )}
      </section>
    </div>
  );
}
