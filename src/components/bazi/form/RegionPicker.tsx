/** 省市县三级联动选择：每一级都可输入、可下拉。 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { ComboBox } from '@/components/ui/ComboBox';

interface Region {
    name: string;
    children?: Region[];
}

interface RegionPickerProps {
    value: string;
    onChange: (value: string) => void;
}

// 从 JSON 加载地区数据
let regionsCache: Region[] | null = null;

async function loadRegions(): Promise<Region[]> {
    if (regionsCache) return regionsCache;
    const res = await fetch('/data/china-regions.json');
    const data = await res.json();
    regionsCache = data;
    return regionsCache!;
}

function RegionCombobox({
    ariaLabel,
    placeholder,
    value,
    options,
    disabled,
    onChange,
}: {
    ariaLabel: string;
    placeholder: string;
    value: string;
    options: string[];
    disabled?: boolean;
    onChange: (value: string) => void;
}) {
    return (
        <ComboBox
            value={value}
            options={options.map(option => ({ value: option, label: option }))}
            onChange={onChange}
            ariaLabel={ariaLabel}
            placeholder={placeholder}
            disabled={disabled}
        />
    );
}

export function RegionPicker({ value, onChange }: RegionPickerProps) {
    const [regions, setRegions] = useState<Region[]>([]);

    useEffect(() => {
        void loadRegions().then(setRegions);
    }, []);
    // 解析当前值为省/市/区
    const parseValue = (val: string): [string, string, string] => {
        if (!val) return ['', '', ''];
        const parts = val.split(/[,，\s]+/).filter(Boolean);
        return [parts[0] || '', parts[1] || '', parts[2] || ''];
    };

    const [province, city, district] = parseValue(value);
    const [selectedProvince, setSelectedProvince] = useState(province);
    const [selectedCity, setSelectedCity] = useState(city);
    const [selectedDistrict, setSelectedDistrict] = useState(district);

    // 同步外部值变化（使用条件更新代替 useEffect）
    const [lastValue, setLastValue] = useState(value);
    if (value !== lastValue) {
        const [p, c, d] = parseValue(value);
        setSelectedProvince(p);
        setSelectedCity(c);
        setSelectedDistrict(d);
        setLastValue(value);
    }

    // 获取当前省份的城市列表
    const cities = useMemo(() => {
        if (!selectedProvince) return [];
        const prov = regions.find(r => r.name === selectedProvince);
        return prov?.children || [];
    }, [selectedProvince, regions]);

    // 获取当前城市的区县列表
    const districts = useMemo(() => {
        if (!selectedCity || !cities.length) return [];
        const city = cities.find(c => c.name === selectedCity);
        return city?.children || [];
    }, [selectedCity, cities]);

    // 构建完整地址并通知父组件
    const updateValue = (prov: string, city: string, dist: string) => {
        const parts = [prov, city, dist].filter(Boolean);
        onChange(parts.join(' '));
    };

    // 处理省份变化
    const handleProvinceChange = (prov: string) => {
        setSelectedProvince(prov);
        setSelectedCity('');
        setSelectedDistrict('');
        updateValue(prov, '', '');
    };

    // 处理城市变化
    const handleCityChange = (city: string) => {
        setSelectedCity(city);
        setSelectedDistrict('');
        updateValue(selectedProvince, city, '');
    };

    // 处理区县变化
    const handleDistrictChange = (dist: string) => {
        setSelectedDistrict(dist);
        updateValue(selectedProvince, selectedCity, dist);
    };

    return (
        <div className="grid grid-cols-3 gap-2">
            <RegionCombobox
                ariaLabel="省/直辖市"
                placeholder="省份"
                value={selectedProvince}
                onChange={handleProvinceChange}
                options={regions.map(region => region.name)}
            />
            <RegionCombobox
                ariaLabel="市/区"
                placeholder="城市"
                value={selectedCity}
                onChange={handleCityChange}
                disabled={cities.length === 0}
                options={cities.map(city => city.name)}
            />
            <RegionCombobox
                ariaLabel="区/县"
                placeholder="区县"
                value={selectedDistrict}
                onChange={handleDistrictChange}
                disabled={districts.length === 0}
                options={districts.map(district => district.name)}
            />
        </div>
    );
}
