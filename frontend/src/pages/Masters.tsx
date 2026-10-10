import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { apiErrorMessage, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { inr } from "@/lib/format";
import type { Customer, Item } from "@/lib/types";
import ExcelUpload from "@/components/ExcelUpload";
import { PageHeader } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ItemForm {
  part_number: string;
  name: string;
  hsn: string;
  gst_rate: string;
  ndp: string;
  mrp: string;
  moq: string;
  unit: string;
  alt_part_number: string;
  tag_mrp: string;
}

const EMPTY_ITEM: ItemForm = {
  part_number: "",
  name: "",
  hsn: "",
  gst_rate: "18",
  ndp: "",
  mrp: "",
  moq: "1",
  unit: "PCS",
  alt_part_number: "",
  tag_mrp: "",
};

interface CustomerForm {
  code: string;
  name: string;
  address: string;
  gstin: string;
  state_code: string;
  customer_type: string;
  dealer_code: string;
  discount_percent: string;
  min_order_qty: string;
}

const EMPTY_CUSTOMER: CustomerForm = {
  code: "",
  name: "",
  address: "",
  gstin: "",
  state_code: "",
  customer_type: "Retailer",
  dealer_code: "",
  discount_percent: "0",
  min_order_qty: "0",
};

function ItemDialog({
  open,
  initial,
  onClose,
}: {
  open: boolean;
  initial: Item | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ItemForm>(EMPTY_ITEM);
  const [key, setKey] = useState("");

  // Re-seed the form whenever the dialog opens for a different item.
  const seedKey = initial ? `edit-${initial.id}` : "new";
  if (open && key !== seedKey) {
    setKey(seedKey);
    setForm(
      initial
        ? {
            part_number: initial.part_number,
            name: initial.name,
            hsn: initial.hsn,
            gst_rate: String(initial.gst_rate),
            ndp: String(initial.ndp || ""),
            mrp: String(initial.mrp || ""),
            moq: String(initial.moq),
            unit: initial.unit,
            alt_part_number: initial.alt_part_number,
            tag_mrp: initial.tag_mrp == null ? "" : String(initial.tag_mrp),
          }
        : EMPTY_ITEM,
    );
  }

  const save = useMutation({
    mutationFn: async () => {
      const ndp = Number.parseFloat(form.ndp || "0") || 0;
      if (initial) {
        const payload: Record<string, unknown> = {
          name: form.name,
          hsn: form.hsn,
          gst_rate: Number.parseFloat(form.gst_rate || "0") || 0,
          ndp,
          moq: Number.parseInt(form.moq || "1", 10) || 1,
          unit: form.unit || "PCS",
          alt_part_number: form.alt_part_number,
        };
        if (form.tag_mrp) payload.tag_mrp = Number.parseFloat(form.tag_mrp);
        return apiPatch<Item>(`/items/${initial.id}`, payload);
      }
      const payload: Record<string, unknown> = {
        part_number: form.part_number,
        name: form.name,
        hsn: form.hsn,
        gst_rate: Number.parseFloat(form.gst_rate || "0") || 0,
        ndp,
        moq: Number.parseInt(form.moq || "1", 10) || 1,
        unit: form.unit || "PCS",
        alt_part_number: form.alt_part_number,
      };
      if (!ndp && form.mrp) payload.mrp = Number.parseFloat(form.mrp);
      return apiPost<Item>("/items", payload);
    },
    onSuccess: () => {
      toast.success(initial ? "Item updated" : "Item added");
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit ${initial.part_number}` : "Add Item"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="item-part">Part Number</Label>
            <Input
              id="item-part"
              value={form.part_number}
              disabled={!!initial}
              onChange={(e) => setForm({ ...form, part_number: e.target.value.toUpperCase() })}
              placeholder="SUZ-12345"
              data-testid="item-part-input"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="item-name">Item Name</Label>
            <Input id="item-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="item-name-input" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="item-hsn">HSN Code</Label>
            <Input id="item-hsn" value={form.hsn} onChange={(e) => setForm({ ...form, hsn: e.target.value })} data-testid="item-hsn-input" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="item-gst">GST Rate %</Label>
            <Input id="item-gst" type="number" value={form.gst_rate} onChange={(e) => setForm({ ...form, gst_rate: e.target.value })} data-testid="item-gst-input" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="item-ndp">NDP (MRP = NDP × 1.18 ÷ 0.78)</Label>
            <Input id="item-ndp" type="number" value={form.ndp} onChange={(e) => setForm({ ...form, ndp: e.target.value })} data-testid="item-ndp-input" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="item-mrp">MRP (only if no NDP)</Label>
            <Input id="item-mrp" type="number" value={form.mrp} disabled={!!form.ndp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} data-testid="item-mrp-input" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="item-moq">MOQ</Label>
            <Input id="item-moq" type="number" value={form.moq} onChange={(e) => setForm({ ...form, moq: e.target.value })} data-testid="item-moq-input" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="item-unit">Unit</Label>
            <Input id="item-unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} data-testid="item-unit-input" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="item-alt">Alternate Part Number</Label>
            <Input id="item-alt" value={form.alt_part_number} onChange={(e) => setForm({ ...form, alt_part_number: e.target.value })} data-testid="item-alt-input" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="item-tag">Tag MRP (confirmed)</Label>
            <Input id="item-tag" type="number" value={form.tag_mrp} onChange={(e) => setForm({ ...form, tag_mrp: e.target.value })} data-testid="item-tag-input" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="item-cancel-button">
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="item-save-button">
            {save.isPending ? "Saving…" : "Save Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Error helper comes from the shared API layer (@/lib/api#apiErrorMessage).

function CustomerDialog({
  open,
  initial,
  onClose,
}: {
  open: boolean;
  initial: Customer | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CustomerForm>(EMPTY_CUSTOMER);
  const [key, setKey] = useState("");

  const seedKey = initial ? `edit-${initial.id}` : "new";
  if (open && key !== seedKey) {
    setKey(seedKey);
    setForm(
      initial
        ? {
            code: initial.code,
            name: initial.name,
            address: initial.address,
            gstin: initial.gstin,
            state_code: initial.state_code,
            customer_type: initial.customer_type,
            dealer_code: initial.dealer_code,
            discount_percent: String(initial.discount_percent),
            min_order_qty: String(initial.min_order_qty),
          }
        : EMPTY_CUSTOMER,
    );
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        address: form.address,
        gstin: form.gstin,
        state_code: form.state_code,
        customer_type: form.customer_type,
        dealer_code: form.dealer_code,
        discount_percent: Number.parseFloat(form.discount_percent || "0") || 0,
        min_order_qty: Number.parseInt(form.min_order_qty || "0", 10) || 0,
      };
      if (initial) return apiPatch<Customer>(`/customers/${initial.id}`, payload);
      return apiPost<Customer>("/customers", { ...payload, code: form.code });
    },
    onSuccess: () => {
      toast.success(initial ? "Customer updated" : "Customer added");
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      onClose();
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit ${initial.code}` : "Add Customer"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="cust-code">Customer Code</Label>
            <Input
              id="cust-code"
              value={form.code}
              disabled={!!initial}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              data-testid="customer-code-input"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cust-name">Customer Name</Label>
            <Input id="cust-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="customer-name-input" />
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="cust-address">Address</Label>
            <Input id="cust-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} data-testid="customer-address-input" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cust-gstin">GST No</Label>
            <Input id="cust-gstin" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} data-testid="customer-gstin-input" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cust-state">State Code</Label>
            <Input id="cust-state" value={form.state_code} onChange={(e) => setForm({ ...form, state_code: e.target.value })} placeholder="07" data-testid="customer-state-input" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cust-type">Customer Type</Label>
            <Select value={form.customer_type} onValueChange={(value: string) => setForm({ ...form, customer_type: value })}>
              <SelectTrigger id="cust-type" data-testid="customer-type-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Wholesaler", "Retailer", "Dealer"].map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cust-dealer">Dealer Code</Label>
            <Input id="cust-dealer" value={form.dealer_code} onChange={(e) => setForm({ ...form, dealer_code: e.target.value })} data-testid="customer-dealer-input" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cust-disc">Discount %</Label>
            <Input id="cust-disc" type="number" value={form.discount_percent} onChange={(e) => setForm({ ...form, discount_percent: e.target.value })} data-testid="customer-discount-input" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cust-moq">Min Order Qty</Label>
            <Input id="cust-moq" type="number" value={form.min_order_qty} onChange={(e) => setForm({ ...form, min_order_qty: e.target.value })} data-testid="customer-moq-input" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="customer-cancel-button">
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="customer-save-button">
            {save.isPending ? "Saving…" : "Save Customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Masters() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [itemDialog, setItemDialog] = useState<{ open: boolean; initial: Item | null }>({ open: false, initial: null });
  const [customerDialog, setCustomerDialog] = useState<{ open: boolean; initial: Customer | null }>({ open: false, initial: null });

  const items = useQuery({ queryKey: ["items"], queryFn: () => apiGet<Item[]>("/items") });
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => apiGet<Customer[]>("/customers") });

  const deleteItem = useMutation({
    mutationFn: (id: string) => apiDelete(`/items/${id}`),
    onSuccess: () => {
      toast.success("Item deleted");
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      void queryClient.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const deleteCustomer = useMutation({
    mutationFn: (id: string) => apiDelete(`/customers/${id}`),
    onSuccess: () => {
      toast.success("Customer deleted");
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  const filteredItems = (items.data ?? []).filter(
    (item) =>
      !search ||
      item.part_number.toLowerCase().includes(search.toLowerCase()) ||
      item.name.toLowerCase().includes(search.toLowerCase()),
  );
  const filteredCustomers = (customers.data ?? []).filter(
    (customer) =>
      !search ||
      customer.code.toLowerCase().includes(search.toLowerCase()) ||
      customer.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <PageHeader
        title="Masters"
        subtitle="Parts catalog and customer list — bulk-loaded from Excel or added by hand"
      />
      <Tabs defaultValue="items">
        <TabsList data-testid="masters-tabs">
          <TabsTrigger value="items" data-testid="masters-tab-items">
            Items ({items.data?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="customers" data-testid="masters-tab-customers">
            Customers ({customers.data?.length ?? 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search part number or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
              data-testid="items-search-input"
            />
            <Button
              size="sm"
              onClick={() => setItemDialog({ open: true, initial: null })}
              data-testid="item-add-button"
            >
              <Plus className="h-4 w-4" /> Add Item
            </Button>
          </div>
          <ExcelUpload
            endpoint="/items/upload"
            templateKind="items"
            label="Upload items Excel (part no, name, HSN, NDP/MRP)"
            onUploaded={() => {
              void queryClient.invalidateQueries({ queryKey: ["items"] });
              void queryClient.invalidateQueries({ queryKey: ["stock"] });
            }}
            testId="items-upload"
          />
          <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
            <Table data-testid="items-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Part No</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>HSN</TableHead>
                  <TableHead className="text-right">NDP</TableHead>
                  <TableHead className="text-right">MRP</TableHead>
                  <TableHead className="text-right">Tag MRP</TableHead>
                  <TableHead className="text-right">GST %</TableHead>
                  <TableHead className="text-right">MOQ</TableHead>
                  <TableHead>Alt Part</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => (
                  <TableRow key={item.id} data-testid={`items-row-${item.part_number}`}>
                    <TableCell className="font-mono text-xs font-medium">{item.part_number}</TableCell>
                    <TableCell>{item.name}</TableCell>
                    <TableCell className="font-mono text-xs">{item.hsn || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{inr(item.ndp)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{inr(item.mrp)}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.tag_mrp == null ? "—" : inr(item.tag_mrp)}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.gst_rate}%</TableCell>
                    <TableCell className="text-right tabular-nums">{item.moq}</TableCell>
                    <TableCell className="font-mono text-xs">{item.alt_part_number || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setItemDialog({ open: true, initial: item })}
                        data-testid={`item-edit-${item.part_number}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          if (window.confirm(`Delete ${item.part_number}?`)) deleteItem.mutate(item.id);
                        }}
                        data-testid={`item-delete-${item.part_number}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                      {items.isPending ? "Loading items…" : "No items yet — upload the Excel or add one by hand."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="customers" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search code, name or GST…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
              data-testid="customers-search-input"
            />
            <Button
              size="sm"
              onClick={() => setCustomerDialog({ open: true, initial: null })}
              data-testid="customer-add-button"
            >
              <Plus className="h-4 w-4" /> Add Customer
            </Button>
          </div>
          <ExcelUpload
            endpoint="/customers/upload"
            templateKind="customers"
            label="Upload customers Excel (code, name, GST, type, discount %, MOQ)"
            onUploaded={() => void queryClient.invalidateQueries({ queryKey: ["customers"] })}
            testId="customers-upload"
          />
          <div className="overflow-hidden rounded-lg border bg-white shadow-xs">
            <Table data-testid="customers-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>GST No</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Dealer Code</TableHead>
                  <TableHead className="text-right">Discount %</TableHead>
                  <TableHead className="text-right">Min Order Qty</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCustomers.map((customer) => (
                  <TableRow key={customer.id} data-testid={`customers-row-${customer.code}`}>
                    <TableCell className="font-mono text-xs font-medium">{customer.code}</TableCell>
                    <TableCell>{customer.name}</TableCell>
                    <TableCell className="font-mono text-xs">{customer.gstin || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{customer.state_code || "—"}</TableCell>
                    <TableCell>{customer.customer_type}</TableCell>
                    <TableCell className="font-mono text-xs">{customer.dealer_code || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{customer.discount_percent}%</TableCell>
                    <TableCell className="text-right tabular-nums">{customer.min_order_qty}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setCustomerDialog({ open: true, initial: customer })}
                        data-testid={`customer-edit-${customer.code}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          if (window.confirm(`Delete ${customer.code}?`)) deleteCustomer.mutate(customer.id);
                        }}
                        data-testid={`customer-delete-${customer.code}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredCustomers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      {customers.isPending ? "Loading customers…" : "No customers yet — upload the Excel or add one by hand."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <ItemDialog
        open={itemDialog.open}
        initial={itemDialog.initial}
        onClose={() => setItemDialog({ open: false, initial: null })}
      />
      <CustomerDialog
        open={customerDialog.open}
        initial={customerDialog.initial}
        onClose={() => setCustomerDialog({ open: false, initial: null })}
      />
    </div>
  );
}
